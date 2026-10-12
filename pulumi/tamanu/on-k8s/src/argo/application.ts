import { type Input, type Output, all, log, output, runtime } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CustomObjectsApi } from '@kubernetes/client-node';
import { cfg } from '../../../../common/cfg.ts';
import { k8sConfig } from '../../../../common/k8s/client.ts';
import { facilityList } from '../config.ts';
import { namespaceName } from '../namespace.ts';

const ARGO_NAMESPACE = cfg.get('argoNamespace') ?? 'argocd';
const ARGO_PROJECT = cfg.get('argoProject') ?? 'tamanu';
const RENDERER_REPO = cfg.get('rendererRepo') ?? 'https://github.com/beyondessential/infra';
const RENDERER_REF = cfg.get('rendererRef') ?? 'main';
const RENDERER_PATH = cfg.get('rendererPath') ?? 'tamanu-render';
const PLUGIN = 'tamanu-render-v1';
const WAIT_MINUTES = cfg.getNumber('argoWaitMinutes') ?? 30;
const POLL_SECONDS = 5;

// Fields that something other than Argo changes on live objects, or that are
// edited by hand and kept between deploys.
function ignoreDifferences() {
  const configMaps = [
    'provisioning',
    'config-central',
    ...facilityList.map((_, i) => `config-facility-${i + 1}`),
  ];
  return [
    {
      group: 'apps',
      kind: 'Deployment',
      jqPathExpressions: [
        '.spec.replicas',
        '.metadata.annotations["downscaler/force-downtime"]',
        '.metadata.annotations["downscaler/original-replicas"]',
      ],
    },
    {
      group: 'postgresql.cnpg.io',
      kind: 'Cluster',
      jqPathExpressions: ['.metadata.annotations["cnpg.io/hibernation"]'],
    },
    ...configMaps.map((name) => ({
      kind: 'ConfigMap',
      name,
      jsonPointers: ['/data', '/binaryData'],
    })),
  ];
}

export function application(params: Input<string>): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource('tamanu-application', {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: {
      name: namespaceName,
      namespace: ARGO_NAMESPACE,
      // Deleting the Application deletes what it created, so a destroy leaves
      // nothing behind even when the namespace outlives it.
      finalizers: ['resources-finalizer.argocd.argoproj.io'],
    },
    spec: {
      project: ARGO_PROJECT,
      source: {
        repoURL: RENDERER_REPO,
        targetRevision: RENDERER_REF,
        path: RENDERER_PATH,
        plugin: { name: PLUGIN, env: [{ name: 'PARAMS', value: params }] },
      },
      destination: { server: 'https://kubernetes.default.svc', namespace: namespaceName },
      syncPolicy: {
        automated: { prune: true, selfHeal: true },
        syncOptions: ['RespectIgnoreDifferences=true', 'ServerSideApply=true'],
        retry: { limit: 5, backoff: { duration: '10s', factor: 2, maxDuration: '3m' } },
      },
      ignoreDifferences: ignoreDifferences(),
    },
  });
}

interface ApplicationStatus {
  sync?: { status?: string; revision?: string };
  health?: { status?: string };
  operationState?: { phase?: string; message?: string };
}

/**
 * Resolves when the Application is synced and healthy. Fails when its last
 * sync operation failed, or when it has not settled within the wait.
 *
 * Skipped during a preview, since the Application does not exist yet.
 */
export function waitForHealthy(app: k8s.apiextensions.CustomResource): Output<string> {
  if (runtime.isDryRun()) {
    return output('preview');
  }
  return all([app.metadata.name, app.metadata.namespace]).apply(async ([name, ns]) => {
    const api = k8sConfig().makeApiClient(CustomObjectsApi);
    const deadline = Date.now() + WAIT_MINUTES * 60_000;
    let last = '';
    while (Date.now() < deadline) {
      const live = (await api.getNamespacedCustomObject({
        group: 'argoproj.io',
        version: 'v1alpha1',
        namespace: ns,
        plural: 'applications',
        name,
      })) as { status?: ApplicationStatus };
      const status = live.status ?? {};
      const phase = status.operationState?.phase;
      if (phase === 'Failed' || phase === 'Error') {
        throw new Error(`Argo CD sync ${phase}: ${status.operationState?.message ?? 'no message'}`);
      }
      const now = `${status.sync?.status ?? 'Unknown'}/${status.health?.status ?? 'Unknown'}`;
      if (now !== last) {
        log.info(`Application ${name}: ${now}`);
        last = now;
      }
      if (status.sync?.status === 'Synced' && status.health?.status === 'Healthy') {
        return 'Healthy';
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
    }
    throw new Error(`Application ${name} was ${last} after ${WAIT_MINUTES} minutes`);
  });
}
