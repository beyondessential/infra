import {
  CoreV1Api,
  CustomObjectsApi,
  type KubernetesObject,
  PatchStrategy,
  setHeaderOptions,
} from '@kubernetes/client-node';
import { log, runtime } from '@pulumi/pulumi';
import { argoNamespace } from '../../../../common/k8s/argo.ts';
import { k8sClient } from '../../../../common/k8s/client.ts';
import { namespaceName } from '../namespace.ts';

// A stack deployed by the previous program has Kubernetes objects that Pulumi created.
// Release 1 marked all of them retain-on-delete, so dropping them from state leaves them in
// place. This hands them over to Argo CD: the objects with stable names are adopted by
// Argo, and the ones with generated names, which Argo cannot adopt, are removed so that it
// can create its own.

const AUTONAMED = 'pulumi.com/autonamed';
const TRACKING = 'argocd.argoproj.io/tracking-id';
const TEMPLATED_FROM = 'bes.tamanu/templated-from';
const MARKER = 'migration';
const WAIT_MINUTES = 10;

const core = k8sClient(CoreV1Api);
const custom = k8sClient(CustomObjectsApi);

interface Kind {
  group: string;
  version: string;
  plural: string;
}

const POSTGRES = { group: 'postgresql.cnpg.io', version: 'v1', plural: 'clusters' };
const GATEWAYS = { group: 'gateway.networking.k8s.io', version: 'v1', plural: 'gateways' };
const CERTIFICATES = { group: 'cert-manager.io', version: 'v1', plural: 'certificates' };

// What Argo renders under new names. Services and ConfigMaps are handled separately, being
// in the core API group.
const REPLACED: Kind[] = [
  { group: 'apps', version: 'v1', plural: 'deployments' },
  { group: 'batch', version: 'v1', plural: 'jobs' },
  { group: 'policy', version: 'v1', plural: 'poddisruptionbudgets' },
  { group: 'gateway.networking.k8s.io', version: 'v1', plural: 'httproutes' },
  GATEWAYS,
  { group: 'gateway.envoyproxy.io', version: 'v1alpha1', plural: 'clienttrafficpolicies' },
];

function notFound(error: unknown): boolean {
  return (error as { code?: number })?.code === 404;
}

async function orNothing<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    if (notFound(error)) return undefined;
    throw error;
  }
}

async function list(kind: Kind): Promise<KubernetesObject[]> {
  const result = (await orNothing(
    custom.listNamespacedCustomObject({ ...kind, namespace: namespaceName }),
  )) as { items?: KubernetesObject[] } | undefined;
  return result?.items ?? [];
}

const autonamed = (o: KubernetesObject) => o.metadata?.annotations?.[AUTONAMED] === 'true';

async function isMigrated(): Promise<boolean> {
  const app = await orNothing(
    custom.getNamespacedCustomObject({
      group: 'argoproj.io',
      version: 'v1alpha1',
      namespace: argoNamespace,
      plural: 'applications',
      name: namespaceName,
    }),
  );
  return app !== undefined;
}

// A database cluster that Argo does not track was created by the previous program.
async function hasLegacyObjects(): Promise<boolean> {
  const clusters = await list(POSTGRES);
  return clusters.some((c) => !c.metadata?.annotations?.[TRACKING]);
}

async function isMarked(): Promise<boolean> {
  const marker = await orNothing(
    core.readNamespacedConfigMap({ name: MARKER, namespace: namespaceName }),
  );
  return marker?.data?.phase === 'retained';
}

// The config ConfigMaps are edited by hand and kept between deploys, so their contents move
// to the names Argo renders, which it then leaves alone.
async function copyConfig(): Promise<void> {
  const { items } = await core.listNamespacedConfigMap({ namespace: namespaceName });
  for (const cm of items.filter(autonamed)) {
    const from = cm.metadata?.labels?.[TEMPLATED_FROM];
    const name = cm.metadata?.name;
    if (!from || !name) continue;
    const target = from.startsWith('provisioning-template-')
      ? 'provisioning'
      : from.startsWith('config-central-template-')
        ? 'config-central'
        : from.startsWith('config-facility-template-')
          ? `config-${name.replace(/-[0-9a-f]{8}$/, '')}`
          : undefined;
    if (!target) continue;
    if (await orNothing(core.readNamespacedConfigMap({ name: target, namespace: namespaceName }))) {
      continue;
    }
    log.info(`Copying ${name} to ${target}`);
    await core.createNamespacedConfigMap({
      namespace: namespaceName,
      body: {
        metadata: { name: target, namespace: namespaceName, labels: { [TEMPLATED_FROM]: from } },
        data: cm.data,
        binaryData: cm.binaryData,
      },
    });
  }
}

// cert-manager owns each certificate through the Gateway that asked for it, so deleting the
// Gateway would delete the certificate and its issued secret. Releasing it keeps the secret
// for the Gateway Argo creates under the same name.
async function releaseCertificates(): Promise<void> {
  const gateways = new Set((await list(GATEWAYS)).filter(autonamed).map((g) => g.metadata?.uid));
  for (const cert of await list(CERTIFICATES)) {
    const owners = cert.metadata?.ownerReferences ?? [];
    if (!owners.some((o) => gateways.has(o.uid))) continue;
    log.info(`Releasing certificate ${cert.metadata?.name}`);
    await custom.patchNamespacedCustomObject(
      {
        ...CERTIFICATES,
        namespace: namespaceName,
        name: cert.metadata!.name!,
        body: { metadata: { ownerReferences: null } },
      },
      setHeaderOptions('Content-Type', PatchStrategy.MergePatch),
    );
  }
}

async function removeReplaced(): Promise<void> {
  for (const kind of REPLACED) {
    for (const object of (await list(kind)).filter(autonamed)) {
      log.info(`Deleting ${kind.plural} ${object.metadata?.name}`);
      await orNothing(
        custom.deleteNamespacedCustomObject({
          ...kind,
          namespace: namespaceName,
          name: object.metadata!.name!,
          propagationPolicy: 'Foreground',
        }),
      );
    }
  }
  const services = await core.listNamespacedService({ namespace: namespaceName });
  for (const service of services.items.filter(autonamed)) {
    log.info(`Deleting service ${service.metadata?.name}`);
    await orNothing(
      core.deleteNamespacedService({ name: service.metadata!.name!, namespace: namespaceName }),
    );
  }
  const configMaps = await core.listNamespacedConfigMap({ namespace: namespaceName });
  for (const cm of configMaps.items.filter(autonamed)) {
    log.info(`Deleting config map ${cm.metadata?.name}`);
    await orNothing(
      core.deleteNamespacedConfigMap({ name: cm.metadata!.name!, namespace: namespaceName }),
    );
  }
}

async function remaining(): Promise<number> {
  let count = 0;
  for (const kind of REPLACED) count += (await list(kind)).filter(autonamed).length;
  const services = await core.listNamespacedService({ namespace: namespaceName });
  count += services.items.filter(autonamed).length;
  return count;
}

async function waitForRemoval(): Promise<void> {
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  while ((await remaining()) > 0) {
    if (Date.now() > deadline) {
      throw new Error(`Legacy objects were still present after ${WAIT_MINUTES} minutes`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

/**
 * Hands a stack deployed by the previous program over to Argo CD. Does nothing for a new
 * stack or one that has already been handed over. Fails before changing anything if the
 * previous program has not marked its resources, since Pulumi would otherwise delete them.
 *
 * During a preview it only checks.
 */
export async function migrateFromLegacy(): Promise<'new' | 'migrated' | 'migrating'> {
  if (await isMigrated()) return 'migrated';
  if (!(await hasLegacyObjects())) return 'new';

  if (!(await isMarked())) {
    throw new Error(
      `${namespaceName} was deployed by the previous program and is not marked for the move to ` +
        `Argo CD. Run one update with the ops ref set to p1-r1 first (for a pull request, add ` +
        `%opsref=p1-r1 to its Deploy line), then go back to the default ref.`,
    );
  }
  if (runtime.isDryRun()) return 'migrating';

  log.info(`Handing ${namespaceName} over to Argo CD`);
  await copyConfig();
  await releaseCertificates();
  await removeReplaced();
  await waitForRemoval();
  return 'migrated';
}
