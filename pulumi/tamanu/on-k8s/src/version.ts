import * as semver from 'semver';
import { cfg } from '../../../common/k8s/coreRef.ts';
import { imageVersion } from './imageVersion.ts';
import { imageTag } from './image.ts';
import { needsLegacyReportRoles } from './reportRoles.ts';

// CD writes an unset option as the string "null".
function configured(): string | undefined {
  const value = cfg.get('appVersion');
  return value == null || value === 'null' ? undefined : value;
}

async function resolve(): Promise<string> {
  const given = configured();
  if (given) return given;

  const found = await imageVersion('beyondessential/tamanu-central', imageTag).catch((error) => {
    throw new Error(`could not read the version of the image tagged ${imageTag}: ${error}`);
  });
  if (!found) {
    throw new Error(`the image tagged ${imageTag} has no version label; set appVersion`);
  }
  return found;
}

/**
 * The Tamanu version being deployed. The `appVersion` option wins when set, as CD sets it from
 * the checkout; otherwise it is read from the image, so that a stack never has to guess it
 * from the tag. Everything that depends on the version, here and in the renderer, uses this.
 */
export const appVersion: string = await resolve();

if (!semver.valid(appVersion)) {
  throw new Error(`appVersion ${JSON.stringify(appVersion)} is not a valid version`);
}

/** Whether the deployment still needs the legacy `raw` and `reporting` role Secrets. */
export const hasLegacyReportRoles = needsLegacyReportRoles(appVersion);
