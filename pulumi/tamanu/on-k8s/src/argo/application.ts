import { type Input, type Output, all, log, output, runtime } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CustomObjectsApi } from '@kubernetes/client-node';
import { cfg } from '../../../../common/cfg.ts';
import { pluginName } from '../../../../common/tamanuRenderer.ts';
import { argoNamespace } from '../../../../common/k8s/argo.ts';
import { k8sConfig } from '../../../../common/k8s/client.ts';
import { configTemplate, domains, facilityList } from '../config.ts';
import { namespaceName } from '../namespace.ts';
import { appVersion } from '../version.ts';
import { channel } from './channel.ts';
import { type LiveApplication, comparedCurrentSpec, settled } from './settled.ts';

const ARGO_NAMESPACE = argoNamespace;
const ARGO_PROJECT = cfg.get('argoProject') ?? 'tamanu';
const RENDERER_REPO = cfg.get('rendererRepo') ?? 'https://github.com/beyondessential/infra';
// The render depends only on the params and the plugin image, never on the
// checkout, so the revision is pinned to a commit that never changes. Argo then
// neither polls for new commits nor re-renders on them; a new plugin image is
// picked up by a hard refresh.
const RENDERER_REF = '14ad80a52dfac3bfb5fb8367eea004029a2a26b0';
// The repo root exists in every commit, unlike the renderer's directory, which
// has moved since the pinned commit.
const RENDERER_PATH = cfg.get('rendererPath') ?? '.';
// The channel's plugin, which is what renders the deployment: the stable one keeps the name
// Applications have always used, so those render without being redeployed. Naming another
// channel's plugin is all a channel switch is: the spec changes, so Argo CD renders it afresh.
// spec: K8STRO#channels
const PLUGIN = pluginName(channel);
const WAIT_MINUTES = cfg.getNumber('argoWaitMinutes') ?? 30;
const POLL_SECONDS = 5;

// Fields that something other than Argo changes on live objects, or that are
// edited by hand and kept between deploys.
// spec: K8STDR#ignored-differences
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
        '.metadata.annotations["tamanu.bes.au/replicas-before-migration"]',
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

// A label value is at most 63 characters, starts and ends with a letter or digit, and holds
// only letters, digits, dashes, underscores and dots.
function labelValue(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 63)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

// What the Argo CD UI can filter and group Applications by. The UI lists labels by name, so
// the version's sorts before the template's.
const LABELS = {
  'bes.tamanu/app-version': labelValue(appVersion),
  // Pull request, release, branch or demo deployment, as Tamanu CD and the demos set it.
  'bes.tamanu/template': labelValue(configTemplate),
  // Which renderer channel renders it.
  // spec: K8STRO#parameters
  'bes.tamanu/renderer-channel': channel,
};

// Argo CD shows these as links on the Application, so the deployment's addresses are one
// click from its page. The title is the part after the slash.
const LINKS = Object.fromEntries(
  Object.entries(domains).map(([name, host]) => [
    `link.argocd.argoproj.io/${name === 'patientPortal' ? 'portal' : name}`,
    `https://${host}`,
  ]),
);

// spec: K8STDR#application
export function application(params: Input<string>): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource('tamanu-application', {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: {
      name: namespaceName,
      namespace: ARGO_NAMESPACE,
      labels: LABELS,
      annotations: {
        ...LINKS,
        // Custom resources gain fields from their CRD defaults and webhooks
        // that the render does not set, which a client-side diff reports as
        // drift forever. Diffing on the server accounts for them.
        'argocd.argoproj.io/compare-options': 'ServerSideDiff=true',
      },
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
  operationState?: { phase?: string; message?: string; finishedAt?: string };
  conditions?: { type?: string; message?: string }[];
}

// Allowance for the clock here differing from the cluster's.
const CLOCK_SKEW_MS = 15_000;

/**
 * Resolves when the Application is synced and healthy for the spec the update applied: until
 * the controller has compared that spec, the status it shows is the previous spec's. Fails
 * when a sync operation finished failing after the wait began, or when it has not settled
 * within the wait. An operation that failed before the wait began is the previous deploy's,
 * which the controller replaces once it notices the update.
 *
 * Skipped during a preview, since the Application does not exist yet.
 */
// spec: K8STDR#update-completion
export function waitForHealthy(app: k8s.apiextensions.CustomResource): Output<string> {
  if (runtime.isDryRun()) {
    return output('preview');
  }
  return all([app.metadata.name, app.metadata.namespace]).apply(async ([name, ns]) => {
    const api = k8sConfig().makeApiClient(CustomObjectsApi);
    const begun = Date.now();
    const deadline = begun + WAIT_MINUTES * 60_000;
    let last = '';
    let problem = '';
    while (Date.now() < deadline) {
      const live = (await api.getNamespacedCustomObject({
        group: 'argoproj.io',
        version: 'v1alpha1',
        namespace: ns,
        plural: 'applications',
        name,
      })) as LiveApplication & { status?: ApplicationStatus };
      const status = live.status ?? {};
      const op = status.operationState;
      const finished = op?.finishedAt ? Date.parse(op.finishedAt) : 0;
      if ((op?.phase === 'Failed' || op?.phase === 'Error') && finished > begun - CLOCK_SKEW_MS) {
        throw new Error(`Argo CD sync ${op.phase}: ${op.message ?? 'no message'}`);
      }
      const comparison =
        status.conditions?.find((c) => c.type === 'ComparisonError')?.message ?? '';
      if (comparison !== problem) {
        if (comparison) log.warn(`Application ${name}: ${comparison}`);
        problem = comparison;
      }
      const now = comparedCurrentSpec(live)
        ? `${status.sync?.status ?? 'Unknown'}/${status.health?.status ?? 'Unknown'}`
        : 'waiting for Argo CD to compare the new spec';
      if (now !== last) {
        log.info(`Application ${name}: ${now}`);
        last = now;
      }
      if (settled(live)) {
        return 'Healthy';
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
    }
    throw new Error(
      `Application ${name} was ${last} after ${WAIT_MINUTES} minutes${problem ? `: ${problem}` : ''}`,
    );
  });
}
