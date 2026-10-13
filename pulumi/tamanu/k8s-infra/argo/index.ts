import * as k8s from '@pulumi/kubernetes';
import { Config } from '@pulumi/pulumi';

// Argo CD applies Tamanu deployments that infra-argo-tamanu-renderer renders. Each deployment
// is an Application created by the tamanu/on-k8s stub; this stack owns the
// controller, the render plugin and the project those Applications run under.

// https://artifacthub.io/packages/helm/argo/argo-cd
// helm chart version (10.10.2 deploys Argo CD v3.5.4)
const ARGO_CD_VERSION = '10.10.2';

const argoCfg = new Config('argo');
const namespaceName = argoCfg.get('namespace') ?? 'argocd';
const RENDER_REPO = 'https://github.com/beyondessential/infra';

// infra-argo-tamanu-renderer is published by that repository's CD. The tag is a required
// config value so the plugin never floats.
const renderImageTag = argoCfg.require('renderImageTag');

const namespace = new k8s.core.v1.Namespace('argocd', { metadata: { name: namespaceName } });

// A CNPG Cluster has no built-in health check, so without this Argo treats it
// as healthy the moment it is created and starts the migrator against a database
// that is not up. Sync waves only wait on health. A hibernated cluster is
// treated as healthy so the schedule's hibernation does not hold a sync.
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
    version: ARGO_CD_VERSION,
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
      applicationSet: { enabled: false },
      configs: {
        cm: {
          // Annotation tracking keeps Argo's bookkeeping off labels, which the
          // deployments already use for their own selectors.
          'application.resourceTrackingMethod': 'annotation',
          'resource.customizations.health.postgresql.cnpg.io_Cluster': CNPG_CLUSTER_HEALTH,
        },
        params: {
          // No ingress: the UI and API are reached with a port-forward.
          'server.insecure': true,
        },
      },
      repoServer: {
        volumes: [{ name: 'cmp-tmp', emptyDir: {} }],
        extraContainers: [
          {
            name: 'infra-argo-tamanu-renderer',
            command: ['/var/run/argocd/argocd-cmp-server'],
            image: `ghcr.io/beyondessential/infra-argo-tamanu-renderer:${renderImageTag}`,
            securityContext: { runAsNonRoot: true, runAsUser: 999 },
            resources: {
              requests: { cpu: '10m', memory: '32Mi' },
              limits: { memory: '256Mi' },
            },
            // The plugin config is baked into the image. The repo server provides
            // the plugin server binary, and the sidecar must not share its /tmp.
            volumeMounts: [
              { mountPath: '/var/run/argocd', name: 'var-files' },
              { mountPath: '/home/argocd/cmp-server/plugins', name: 'plugins' },
              { mountPath: '/tmp', name: 'cmp-tmp' },
            ],
          },
        ],
      },
    },
  },
  { parent: namespace, deleteBeforeReplace: true },
);

// Applications are limited to the render repository and to Tamanu deployment
// namespaces. `tamanu-meta-*` hold the version and meta servers and are not
// deployed this way. No cluster-scoped kind is allowed.
new k8s.apiextensions.CustomResource(
  'argo-project-tamanu',
  {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'AppProject',
    metadata: { name: 'tamanu', namespace: namespaceName },
    spec: {
      description: 'Tamanu deployments rendered by infra-argo-tamanu-renderer',
      sourceRepos: [RENDER_REPO],
      destinations: [
        { server: 'https://kubernetes.default.svc', namespace: 'tamanu-*' },
        { server: '*', namespace: '!tamanu-meta-*' },
      ],
      clusterResourceWhitelist: [],
    },
  },
  // The chart installs the custom resource definitions these need.
  { parent: namespace, dependsOn: [release] },
);

// The default project permits any source and destination, so an Application
// that names it would escape the project above. Emptying it leaves it unusable.
new k8s.apiextensions.CustomResource(
  'argo-project-default',
  {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'AppProject',
    metadata: { name: 'default', namespace: namespaceName },
    spec: { sourceRepos: [], destinations: [], clusterResourceWhitelist: [] },
  },
  // The chart installs the custom resource definitions these need.
  { parent: namespace, dependsOn: [release] },
);

// Tamanu CD writes the Application for a deployment, through the same Tailscale
// identity it deploys with. It can do nothing else in this namespace.
const role = new k8s.rbac.v1.Role(
  'argo-tamanu-deploy',
  {
    metadata: { name: 'tamanu-deploy', namespace: namespaceName },
    rules: [
      {
        apiGroups: ['argoproj.io'],
        resources: ['applications'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
    ],
  },
  { parent: namespace },
);

new k8s.rbac.v1.RoleBinding(
  'argo-tamanu-deploy',
  {
    metadata: { name: 'tamanu-deploy', namespace: namespaceName },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: role.metadata.name },
    subjects: [{ kind: 'Group', name: 'tailscale:tamanu-deploy' }],
  },
  { parent: namespace },
);
