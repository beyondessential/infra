import {
  ComponentResource,
  type Input,
  type Output,
  all,
  interpolate,
  log,
  output,
} from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CustomObjectsApi } from '@kubernetes/client-node';
import * as semver from 'semver';
import { k8sConfig } from '../../../../common/k8s/client.ts';
import { k8sWaitFor } from '../../../../common/k8s/waitFor.ts';

const SEED_NAMESPACE = 'tamanu-seed';
const SNAPSHOT_GROUP = 'snapshot.storage.k8s.io';
const SNAPSHOT_VERSION = 'v1';
const SNAPSHOT_API_VERSION = `${SNAPSHOT_GROUP}/${SNAPSHOT_VERSION}`;
const VERSION_ANNOTATION = 'pgsnap.bes.au/for-version';

const SNAPSHOT_NAME = 'seed-snapshot';

export interface CloneSeedSnapshotArgs {
  parent: ComponentResource;
  namespace: Input<string>;
  source: SnapshotSource;
}

export interface FindSnapshotSourceArgs {
  // App version (e.g. "2.53.1") the deploy is running.
  appVersion?: string;
  // Select the newest snapshot from *before* appVersion's minor rather than a matching
  // one, so the deploy restores older data and its migrations actually run.
  previousMinor?: boolean;
}

export interface SnapshotSource {
  name: string;
  version: string;
  driver: string;
  handle: string;
}

// Create a namespace-scoped clone of a VolumeSnapshot living in `tamanu-seed`.
//
// A fresh VolumeSnapshotContent is created that points at the same underlying
// CSI snapshotHandle (with deletionPolicy: Retain so the source storage
// snapshot is untouched on teardown), plus a pre-provisioned VolumeSnapshot
// bound to that content. CNPG can then restore from the namespace-local
// VolumeSnapshot, and all the clone resources are owned by this stack and
// get cleaned up with the deploy.
export function cloneSeedSnapshot({
  parent,
  namespace,
  source: resolvedSource,
}: CloneSeedSnapshotArgs): Output<string> {
  const source: Output<SnapshotSource> = output(resolvedSource);

  // VolumeSnapshotContent is cluster-scoped, so include the deploy namespace
  // in the name to keep it unique across concurrent tamanu deploys. We name
  // it explicitly (rather than reading `content.metadata.name` back off the
  // resource) because `apiextensions.CustomResource` doesn't populate
  // `.metadata` on the JS instance when the args omit it.
  const contentName = interpolate`${SNAPSHOT_NAME}-${namespace}`;

  // Immutable fields (driver, snapshotHandle) require replace rather than
  // patch whenever the source snapshot changes. deleteBeforeReplace ensures
  // we never collide on the cluster-scoped content name during replacement.
  const content = new k8s.apiextensions.CustomResource(
    'seed-snapshot-content',
    {
      apiVersion: SNAPSHOT_API_VERSION,
      kind: 'VolumeSnapshotContent',
      metadata: {
        name: contentName,
      },
      spec: {
        driver: source.driver,
        deletionPolicy: 'Retain',
        source: { snapshotHandle: source.handle },
        volumeSnapshotRef: {
          name: SNAPSHOT_NAME,
          namespace,
        },
      },
    },
    {
      parent,
      replaceOnChanges: ['spec.driver', 'spec.source.snapshotHandle'],
      deleteBeforeReplace: true,
    },
  );

  const snapshot = new k8s.apiextensions.CustomResource(
    'seed-snapshot',
    {
      apiVersion: SNAPSHOT_API_VERSION,
      kind: 'VolumeSnapshot',
      metadata: {
        name: SNAPSHOT_NAME,
        namespace,
      },
      spec: {
        source: { volumeSnapshotContentName: contentName },
      },
    },
    {
      parent,
      dependsOn: [content],
      replaceOnChanges: ['spec.source.volumeSnapshotContentName'],
      deleteBeforeReplace: true,
    },
  );

  const ready = k8sWaitFor(
    `VolumeSnapshot ${SNAPSHOT_NAME} readyToUse`,
    async (kc, { namespace, name }) => {
      const api = kc.makeApiClient(CustomObjectsApi);
      const resp = (await api.getNamespacedCustomObject({
        group: SNAPSHOT_GROUP,
        version: SNAPSHOT_VERSION,
        namespace,
        plural: 'volumesnapshots',
        name,
      })) as { status?: { readyToUse?: boolean; error?: { message?: string } } };
      if (resp.status?.error?.message) {
        throw new Error(`Seed snapshot ${name} error: ${resp.status.error.message}`);
      }
      if (!resp.status?.readyToUse) {
        throw new Error(`Seed snapshot ${name} not yet ready`);
      }
    },
    all([namespace, snapshot.metadata.name]).apply(([namespace, name]) => ({
      namespace: namespace as string,
      name: name as string,
    })),
    { limitRetries: 120 },
  );

  return all([ready, snapshot.metadata.name]).apply(([, name]) => name as string);
}

// Resolve which seed snapshot a deploy should restore from, or undefined to provision an
// empty database instead. Callers must await this before constructing resources, since
// Pulumi cannot decide whether to create a resource from an asynchronous lookup.
export async function findSnapshotSource({
  appVersion,
  previousMinor = false,
}: FindSnapshotSourceArgs): Promise<SnapshotSource | undefined> {
  const api = k8sConfig().makeApiClient(CustomObjectsApi);

  const list = (await api.listNamespacedCustomObject({
    group: SNAPSHOT_GROUP,
    version: SNAPSHOT_VERSION,
    namespace: SEED_NAMESPACE,
    plural: 'volumesnapshots',
  })) as {
    items?: Array<{
      metadata?: { name?: string; annotations?: Record<string, string> };
      status?: { readyToUse?: boolean; boundVolumeSnapshotContentName?: string };
    }>;
  };

  const candidates = (list.items ?? [])
    .filter((s) => s.status?.readyToUse === true)
    .filter((s) => !!s.metadata?.annotations?.[VERSION_ANNOTATION])
    .filter((s) => !!s.status?.boundVolumeSnapshotContentName)
    .map((s) => ({
      name: s.metadata!.name!,
      version: s.metadata!.annotations![VERSION_ANNOTATION],
      boundContent: s.status!.boundVolumeSnapshotContentName!,
    }))
    .filter((s) => semver.valid(s.version))
    .sort((a, b) => semver.rcompare(a.version, b.version));

  if (candidates.length === 0) {
    log.warn(
      `No ready seed snapshots (with valid semver ${VERSION_ANNOTATION} annotation) in ${SEED_NAMESPACE}; provisioning an empty database instead`,
    );
    return undefined;
  }

  const target = appVersion && semver.valid(appVersion) ? semver.parse(appVersion) : null;
  const matchesTarget = (v: string) =>
    target !== null && semver.major(v) === target.major && semver.minor(v) === target.minor;

  const chosen = pickCandidate({ candidates, target, previousMinor, matchesTarget });

  if (!chosen) {
    // Falling back to the deploy's own version would restore data its migrations have
    // already been applied to, which is the opposite of what previousMinor is asking for.
    log.warn(
      `No seed snapshot predates v${appVersion}; provisioning an empty database instead, so migrations still run from scratch`,
    );
    return undefined;
  }

  if (previousMinor) {
    log.info(`Selected seed snapshot ${chosen.name} (v${chosen.version}) to migrate forward from`);
  } else if (target && !matchesTarget(chosen.version)) {
    log.warn(
      `No seed snapshot found matching v${target.major}.${target.minor}.x; falling back to newest (${chosen.version})`,
    );
  } else {
    log.info(`Selected seed snapshot ${chosen.name} (v${chosen.version})`);
  }

  const content = (await api.getClusterCustomObject({
    group: SNAPSHOT_GROUP,
    version: SNAPSHOT_VERSION,
    plural: 'volumesnapshotcontents',
    name: chosen.boundContent,
  })) as {
    spec?: { driver?: string };
    status?: { snapshotHandle?: string };
  };

  const driver = content.spec?.driver;
  const handle = content.status?.snapshotHandle;
  if (!driver || !handle) {
    throw new Error(
      `Seed snapshot ${chosen.name} content ${chosen.boundContent} missing driver or snapshotHandle`,
    );
  }

  return { name: chosen.name, version: chosen.version, driver, handle };
}

export interface Candidate {
  name: string;
  version: string;
  boundContent: string;
}

// `candidates` is sorted newest-first, so the first match in each branch is the best one.
export function pickCandidate({
  candidates,
  target,
  previousMinor,
  matchesTarget,
}: {
  candidates: Candidate[];
  target: semver.SemVer | null;
  previousMinor: boolean;
  matchesTarget: (version: string) => boolean;
}): Candidate | undefined {
  if (previousMinor && target) {
    return candidates.find(
      (s) =>
        semver.major(s.version) < target.major ||
        (semver.major(s.version) === target.major && semver.minor(s.version) < target.minor),
    );
  }

  return (target && candidates.find((s) => matchesTarget(s.version))) || candidates[0];
}
