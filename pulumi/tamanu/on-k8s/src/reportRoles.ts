import * as semver from 'semver';

/** The first release whose Tamanu manages its own raw and reporting roles. */
const TAMANU_MANAGES_REPORT_ROLES = '2.60.0-0';

/**
 * Whether a Tamanu release still needs the `raw` and `reporting` database roles' password
 * Secrets. Must agree with `has_legacy_report_roles` in infra-argo-tamanu-renderer, which
 * renders what refers to them.
 */
export function needsLegacyReportRoles(version: string): boolean {
  return !semver.gte(version, TAMANU_MANAGES_REPORT_ROLES);
}
