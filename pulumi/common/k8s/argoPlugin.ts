import { createHash } from 'node:crypto';
import { AppsV1Api } from '@kubernetes/client-node';
import { type Input, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { argoNamespace } from './argo.ts';
import { k8sClient } from './client.ts';

// Adds a config management plugin to the cluster's Argo CD repo server, from
// whichever stack owns the plugin. The shared install (k8s-essentials) does not
// list plugins: each stack contributes its own sidecar with a server-side patch,
// and a container is keyed by name, so they do not collide.

// What the Argo CD chart labels its repo server with, whatever the release is
// named.
const REPO_SERVER = 'app.kubernetes.io/part-of=argocd,app.kubernetes.io/component=repo-server';

// Volumes Argo CD's own manifests give the repo server for its sidecars: the
// plugin server binary it copies in, and the directory plugins register under.
const VAR_FILES = 'var-files';
const PLUGINS = 'plugins';

// Where the repo server's plugin sidecars read their config from.
const CONFIG_DIR = '/home/argocd/cmp-server/config';
const CONFIG_FILE = 'plugin.yaml';

export interface ArgoPluginArgs {
  /** The plugin's name, which is also its container's. */
  name: string;
  /** The plugin's image. It is pulled every time the sidecar starts, so a tag may move. */
  image: Input<string>;
  /**
   * The plugin's config, a `ConfigManagementPlugin` document. It is supplied to the sidecar
   * rather than carried in the image, so that several plugins can share one image.
   */
  config: string;
  /** Environment for the plugin's process, which the sidecar's image reads. */
  env?: Record<string, string>;
  /** Where Argo CD is installed. */
  namespace?: string;
}

async function findRepoServer(namespace: string): Promise<string> {
  const api = k8sClient(AppsV1Api);
  const found = await api.listNamespacedDeployment({ namespace, labelSelector: REPO_SERVER });
  if (found.items.length !== 1) {
    throw new Error(
      `Expected one Argo CD repo server in ${namespace} (${REPO_SERVER}), found ${found.items.length}. ` +
        'Argo CD is installed by k8s-essentials, which has to be applied first.',
    );
  }

  const [server] = found.items;
  const volumes = new Set(server.spec?.template.spec?.volumes?.map((volume) => volume.name));
  for (const wanted of [VAR_FILES, PLUGINS]) {
    if (!volumes.has(wanted)) {
      throw new Error(
        `The Argo CD repo server has no ${wanted} volume, which plugin sidecars mount`,
      );
    }
  }

  return server.metadata?.name ?? '';
}

export function argoPlugin({
  name,
  image,
  config,
  env = {},
  namespace = argoNamespace,
}: ArgoPluginArgs): k8s.apps.v1.DeploymentPatch {
  // A sidecar must not share /tmp with the repo server, or with another plugin.
  const tmp = `cmp-tmp-${name}`;
  const configVolume = `cmp-config-${name}`;

  // spec: K8STRO#plugins
  const configMap = new k8s.core.v1.ConfigMap(`argo-plugin-${name}`, {
    metadata: { namespace },
    data: { [CONFIG_FILE]: config },
  });

  return new k8s.apps.v1.DeploymentPatch(`argo-plugin-${name}`, {
    metadata: {
      name: output(findRepoServer(namespace)),
      namespace,
      annotations: { 'pulumi.com/patchForce': 'true' },
    },
    spec: {
      template: {
        metadata: {
          // A file mounted from a ConfigMap by `subPath` is never updated in a running
          // container, so a change to the config has to replace the pod.
          annotations: {
            [`bes.au/cmp-config-${name}`]: createHash('sha256').update(config).digest('hex'),
          },
        },
        spec: {
          volumes: [
            { name: tmp, emptyDir: {} },
            { name: configVolume, configMap: { name: configMap.metadata.name } },
          ],
          containers: [
            {
              name,
              image,
              // spec: K8STRO#plugins
              // A tag that moves is otherwise served from whatever the node last pulled.
              imagePullPolicy: 'Always',
              command: ['/var/run/argocd/argocd-cmp-server'],
              env: Object.entries(env).map(([name, value]) => ({ name, value })),
              securityContext: { runAsNonRoot: true, runAsUser: 999 },
              resources: {
                requests: { cpu: '10m', memory: '32Mi' },
                limits: { memory: '256Mi' },
              },
              volumeMounts: [
                { mountPath: '/var/run/argocd', name: VAR_FILES },
                { mountPath: '/home/argocd/cmp-server/plugins', name: PLUGINS },
                { mountPath: '/tmp', name: tmp },
                { mountPath: `${CONFIG_DIR}/${CONFIG_FILE}`, name: configVolume, subPath: CONFIG_FILE },
              ],
            },
          ],
        },
      },
    },
  });
}
