import type { Output } from '@pulumi/pulumi';
import { cloneSeedSnapshot, findSnapshotSource } from '../central/seedSnapshot.ts';
import { seedFromPreviousMinor, seedSnapshot } from '../config.ts';
import { namespace } from '../namespace.ts';
import { appVersion } from '../version.ts';
import { centralServer } from './secrets.ts';

/**
 * The seed snapshot central's database is restored from, cloned into the namespace and ready
 * to use, or nothing to start from an empty database.
 *
 * This is the stub's because it needs the live cluster and a cluster-scoped object, which
 * the controller has no rights to create. The clone keeps the identity the previous program
 * gave it, so a stack that was seeded keeps it.
 */
export async function seedParams(): Promise<{ snapshot: Output<string> } | undefined> {
  if (!seedSnapshot) return undefined;
  const source = await findSnapshotSource({ appVersion, previousMinor: seedFromPreviousMinor });
  if (!source) return undefined;
  return { snapshot: cloneSeedSnapshot({ parent: centralServer, namespace, source }) };
}
