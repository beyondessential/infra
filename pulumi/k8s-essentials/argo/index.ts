import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/k8s/coreRef.ts';
import { ARGO_CD_VERSION } from '../versions.ts';

// The Argo CD controller, shared by anything on the cluster that wants GitOps.
// What applies Tamanu deployments through it (the project they run under and
// who may create them) lives in tamanu/k8s-infra.

const namespaceName = cfg.get('argoNamespace') ?? 'argocd';

// A config management plugin runs as a sidecar of the repo server. Each is an
// image with its plugin config baked in, named as the plugin.
interface ArgoPlugin {
  name: string;
  image: string;
}
const plugins = cfg.getObject<ArgoPlugin[]>('argoPlugins') ?? [];

const namespace = new k8s.core.v1.Namespace('argocd', { metadata: { name: namespaceName } });

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
          // Annotation tracking keeps Argo's bookkeeping off labels, which
          // applications may already use for their own selectors.
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
        extraContainers: plugins.map(({ name, image }) => ({
          name,
          command: ['/var/run/argocd/argocd-cmp-server'],
          image,
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
        })),
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
    metadata: { name: 'default', namespace: namespaceName },
    spec: { sourceRepos: [], destinations: [], clusterResourceWhitelist: [] },
  },
  // The chart installs the custom resource definitions this needs.
  { parent: namespace, dependsOn: [release] },
);
