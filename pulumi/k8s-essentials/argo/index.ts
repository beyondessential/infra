import * as k8s from '@pulumi/kubernetes';
import { argoNamespace } from '../../common/k8s/argo.ts';
import { cfg, clusterFullName } from '../../common/k8s/coreRef.ts';
import { ARGO_CD_VERSION } from '../versions.ts';

// The Argo CD controller, shared by anything on the cluster that wants GitOps.
// What applies Tamanu deployments through it (the project they run under, who
// may create them, and the plugin that renders them) lives in tamanu/k8s-infra.
// A stack that needs a config management plugin adds its own sidecar with
// common/k8s/argoPlugin.ts, so none are listed here.

const namespaceName = argoNamespace;

// Installs a different chart than the pinned one, to start from an older release
// and exercise an upgrade. Remove the key to return to the pin.
const chartVersion = cfg.get('argoVersion') ?? ARGO_CD_VERSION;

const namespace = new k8s.core.v1.Namespace('argocd-system', { metadata: { name: namespaceName } });

// A CNPG Cluster has no built-in health check, so without this Argo treats it
// as healthy the moment it is created, and sync waves that wait on health do not
// wait for the database. A hibernated cluster, which the schedule marks with an annotation,
// is treated as healthy so that hibernation does not hold a sync.
//
// This reads the conditions and compares whole strings. The Lua here has no `string`
// library, so a script that searches or lowercases the phase fails with an error for
// any cluster that is not healthy, and Argo then cannot compute the application's
// health at all.
const CNPG_CLUSTER_HEALTH = `
local hs = {}
local status = obj.status
local annotations = obj.metadata.annotations
if annotations ~= nil and annotations["cnpg.io/hibernation"] == "on" then
  hs.status = "Healthy"
  hs.message = "Hibernated"
  return hs
end
if status ~= nil and status.conditions ~= nil then
  for _, condition in ipairs(status.conditions) do
    if condition.type == "Ready" and condition.status == "True" then
      hs.status = "Healthy"
      hs.message = status.phase or "Ready"
      return hs
    end
  end
end
hs.status = "Progressing"
hs.message = "Waiting for the cluster"
if status ~= nil and status.phase ~= nil then
  hs.message = status.phase
end
return hs
`.trim();

const release = new k8s.helm.v3.Release(
  'argo-cd',
  {
    name: 'argo-cd',
    chart: 'argo-cd',
    version: chartVersion,
    repositoryOpts: { repo: 'https://argoproj.github.io/argo-helm' },
    namespace: namespace.metadata.name,
    values: {
      global: {
        affinity: {
          nodeAffinity: {
            type: 'hard',
            matchExpressions: [
              { key: 'bes.node.purpose', operator: 'In', values: ['system'] },
              { key: 'bes.node.arch', operator: 'In', values: ['arm64'] },
            ],
          },
        },
      },
      dex: { enabled: false },
      notifications: { enabled: false },
      configs: {
        cm: {
          // Annotation tracking keeps Argo's bookkeeping off labels, which
          // applications may already use for their own selectors.
          'application.resourceTrackingMethod': 'annotation',
          'resource.customizations.health.postgresql.cnpg.io_Cluster': CNPG_CLUSTER_HEALTH,
          // The Tailscale grants decide who can reach the server, so it has no login of its
          // own. Anyone who reaches it acts as the default role in `rbac` below.
          'users.anonymous.enabled': true,
          'admin.enabled': false,
        },
        rbac: {
          // Anonymous users can run Tamanu deployments and nothing else: the default role
          // is scoped to the `tamanu` project, because the controller itself can write to
          // the whole cluster and an engineer's own access does not.
          'policy.default': 'role:tamanu',
          'policy.csv': [
            'p, role:tamanu, applications, *, tamanu/*, allow',
            // Waking a hibernated deployment: "Create Job" on its suspended `wake` CronJob.
            'p, role:tamanu, applications, action/batch/CronJob/create-job, tamanu/*, allow',
            'p, role:tamanu, logs, get, tamanu/*, allow',
            'p, role:tamanu, projects, get, tamanu, allow',
          ].join('\n'),
        },
        params: {
          // TLS ends at the Tailscale proxy in front of the server.
          'server.insecure': true,
        },
      },
    },
  },
  { parent: namespace, deleteBeforeReplace: true },
);

// The default project permits any source and destination, so an Application
// that names it would escape the project of whoever it belongs to. Emptying it
// leaves it unusable; each consumer defines its own project.
new k8s.apiextensions.CustomResource(
  'argo-project-default',
  {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'AppProject',
    metadata: {
      name: 'default',
      namespace: namespaceName,
      // Argo CD's server creates this project itself on startup, so its fields
      // are already owned by it. Take them over rather than conflict.
      annotations: { 'pulumi.com/patchForce': 'true' },
    },
    spec: { sourceRepos: [], destinations: [], clusterResourceWhitelist: [] },
  },
  // The chart installs the custom resource definitions this needs.
  { parent: namespace, dependsOn: [release] },
);

// The UI and API, reached over Tailscale only. Who may reach them is set by the grants on
// the tag, in the tailnet policy. The operator's tag owners must include the tag below.
const tailscaleName = cfg.get('argoTailscaleName') ?? `argocd-${clusterFullName}`;
// Each cluster's Tailscale operator owns its own tags, so the demo cluster sets this to
// `tag:k8s-demo,tag:k8s-demo-argo`.
const tailscaleTags = cfg.get('argoTailscaleTags') ?? 'tag:k8s,tag:k8s-argo';
new k8s.networking.v1.Ingress(
  'argo-cd-tailscale',
  {
    metadata: {
      namespace: namespaceName,
      annotations: {
        'tailscale.com/hostname': tailscaleName,
        'tailscale.com/tags': tailscaleTags,
      },
    },
    spec: {
      ingressClassName: 'tailscale',
      tls: [{ hosts: [tailscaleName] }],
      rules: [
        {
          host: tailscaleName,
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: {
                  // The chart names it after the release.
                  service: { name: 'argo-cd-argocd-server', port: { number: 80 } },
                },
              },
            ],
          },
        },
      ],
    },
  },
  { parent: namespace, dependsOn: [release] },
);
