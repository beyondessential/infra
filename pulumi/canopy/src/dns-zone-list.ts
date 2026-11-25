/**
 * What a core stack publishes about the zone it owns.
 *
 * `apex`, `id` and `roleArn` are optional because they are read from another
 * stack's outputs: a stack with no zone, or one not yet deployed since being
 * pointed at Canopy, simply publishes nothing for them.
 */
export interface CoreZone {
  /** The core stack the zone was read from, for error messages. */
  stack: string;
  /** Account the zone lives in. */
  account: string;
  apex?: string;
  id?: string;
  roleArn?: string;
}

/**
 * The zones one core stack holds: its primary zone and each extra zone.
 *
 * All of them share the core's account and its one zone role, so a core named in
 * the configuration brings every zone it holds. A core publishing no zone yields
 * one entry with neither apex nor id, which `dnsZoneList` refuses.
 */
// spec: CTLS#managed-zones
export function coreZones(
  stack: string,
  account: string,
  roleArn: string | undefined,
  primary: { apex?: string; id?: string },
  extra: { [apex: string]: string } | undefined,
): CoreZone[] {
  const zones: CoreZone[] = [];
  if (primary.apex && primary.id) {
    zones.push({ stack, account, roleArn, ...primary });
  }
  for (const [apex, id] of Object.entries(extra ?? {})) {
    zones.push({ stack, account, roleArn, apex, id });
  }
  return zones.length > 0 ? zones : [{ stack, account, roleArn }];
}

/**
 * Render `CANOPY_DNS_ZONES` — `apex=hosted-zone-id[=role-arn]` entries, comma
 * separated.
 *
 * A zone in `canopyAccount` is written directly and carries no role; one
 * anywhere else is reached by assuming that account's role, and having no role
 * to name is a configuration error rather than something to leave out: an entry
 * silently dropped here reads as a zone Canopy was never given, which is
 * reported as the group's domain being uncovered rather than as the missing
 * plumbing it is.
 */
// spec: CTLS#managed-zones
export function dnsZoneList(canopyAccount: string, zones: CoreZone[]): string {
  return zones
    .map(({ stack, account, apex, id, roleArn }) => {
      if (!apex || !id) {
        throw new Error(`${stack} publishes no DNS zone, so Canopy cannot manage one there`);
      }
      if (account === canopyAccount) {
        return `${apex}=${id}`;
      }
      if (!roleArn) {
        throw new Error(
          `${stack} (account ${account}) publishes no canopyDnsRoleArn, so Canopy has no way into ` +
            `${apex}: set canopyInfra on that stack and deploy it first`,
        );
      }
      return `${apex}=${id}=${roleArn}`;
    })
    .join(',');
}
