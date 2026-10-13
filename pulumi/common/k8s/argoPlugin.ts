import { AppsV1Api } from '@kubernetes/client-node';
import { type Input, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
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

export interface ArgoPluginArgs {
  /** The plugin's name, which is also its container's. */
  name: string;
  /** An image with the plugin config baked in at /home/argocd/cmp-server/config/plugin.yaml. */
  image: Input<string>;
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
  namespace = 'argocd',
}: ArgoPluginArgs): k8s.apps.v1.DeploymentPatch {
  // A sidecar must not share /tmp with the repo server, or with another plugin.
  const tmp = `cmp-tmp-${name}`;

  return new k8s.apps.v1.DeploymentPatch(`argo-plugin-${name}`, {
    metadata: {
      name: output(findRepoServer(namespace)),
      namespace,
      annotations: { 'pulumi.com/patchForce': 'true' },
    },
    spec: {
      template: {
        spec: {
          volumes: [{ name: tmp, emptyDir: {} }],
          containers: [
            {
              name,
              image,
              command: ['/var/run/argocd/argocd-cmp-server'],
              securityContext: { runAsNonRoot: true, runAsUser: 999 },
              resources: {
                requests: { cpu: '10m', memory: '32Mi' },
                limits: { memory: '256Mi' },
              },
              volumeMounts: [
                { mountPath: '/var/run/argocd', name: VAR_FILES },
                { mountPath: '/home/argocd/cmp-server/plugins', name: PLUGINS },
                { mountPath: '/tmp', name: tmp },
              ],
            },
          ],
        },
      },
    },
  });
}
