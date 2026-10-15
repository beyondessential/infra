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
// wait for the database. A hibernated cluster is treated as healthy so the
// schedule's hibernation does not hold a sync.
const CNPG_CLUSTER_HEALTH = `
local hs = {}
if obj.status ~= nil and obj.status.phase ~= nil then
  hs.message = obj.status.phase
  if obj.status.phase == "Cluster in healthy state" or string.find(string.lower(obj.status.phase), "hibernat") then
    hs.status = "Healthy"
  else
    hs.status = "Progressing"
  end
  return hs
end
hs.status = "Progressing"
hs.message = "Waiting for the cluster"
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
new k8s.networking.v1.Ingress(
  'argo-cd-tailscale',
  {
    metadata: {
      namespace: namespaceName,
      annotations: {
        'tailscale.com/hostname': tailscaleName,
        'tailscale.com/tags': 'tag:k8s,tag:k8s-argo',
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
