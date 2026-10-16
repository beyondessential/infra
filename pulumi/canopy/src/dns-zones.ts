import { type Output, all } from '@pulumi/pulumi';

import { cfg } from '../../common/k8s/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';
import { canopyInfra } from './canopy-infra.ts';
import { type CoreZone, dnsZoneList } from './dns-zone-list.ts';

/**
 * Core stacks whose zone Canopy manages, as `bes/core/<stack>` references.
 *
 * Named by stack rather than by zone so nothing here carries a hosted zone id or
 * a role ARN: each core stack publishes its own, and a zone is added by pointing
 * that account's core stack at canopy-infra and naming it here.
 *
 * Distinct from `domains`, which is Canopy's own web hostnames.
 */
const zoneStacks: string[] = cfg.getObject('dnsZoneStacks') ?? [];

const zones: Output<CoreZone>[] = zoneStacks.map((stack) => {
  const core = new CrossStack(stack);
  const zone = core.zone();
  return all([core.accountId(), zone.name, zone.id, zone.canopyDnsRoleArn]).apply(
    ([account, apex, id, roleArn]) => ({ stack, account, apex, id, roleArn }),
  );
});

/**
 * `CANOPY_DNS_ZONES`: the zones Canopy may write records in.
 *
 * Undefined where none is configured, which Canopy reads as having no zone — the
 * domains pod idles and the monitor reports any group domain left uncovered.
 *
 * Only names in a configured zone are Canopy's to act on, and DNS delegation
 * makes that exact: the challenge record for a name under a delegated subzone has
 * to go in that subzone, or the delegation shadows it and validation fails. So a
 * subzone needs its own entry however much of its parent is configured.
 */
export const dnsZones: Output<string> | undefined =
  canopyInfra && zones.length > 0
    ? all([canopyInfra.get<string | undefined>('canopyDomainsRoleArn'), all(zones)]).apply(
        ([domainsRoleArn, zones]) => {
          if (!domainsRoleArn) {
            throw new Error(
              'canopy-infra publishes no canopyDomainsRoleArn, so there is no identity to reach a ' +
                'zone with: deploy canopy-infra before naming zones here',
            );
          }
          // Which account Canopy's own identity is in, and so which zones it can
          // write without assuming anything.
          return dnsZoneList(domainsRoleArn.split(':')[4], zones);
        },
      )
    : undefined;
