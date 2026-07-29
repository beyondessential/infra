import { all, interpolate } from '@pulumi/pulumi';

import { instances, patientPortalDomain, redirects, retired, type Server } from './config.ts';
import { failIfIncorrectAccount } from '../../../common/coreRef.ts';
failIfIncorrectAccount();

// A retired deployment has no servers, so none of the infrastructure that serves
// them: no instances, firewall, AWS Backup plan, kopia repository or ACME-DNS
// users. Its `facilities` config is still required, because that is where the
// hostnames it redirects are derived from.
const live = retired ? undefined : await import('./live.ts');
if (redirects.length > 0) {
  await import('./retired.ts');
}

export const backupBucket = live?.backupBucket;
export const backupReadOnlyUser = live?.backupReadOnlyUser;
export const backupUsers = live?.backupUsers;
export const deviceRoleArn = live?.deviceRoleArn;
export const maintenanceRoleArn = live?.maintenanceRoleArn;
export const bucketArn = live?.bucketArn;
export const acmeDnsUsers = live?.acmeDnsUsers;

export { tailscaleTags } from './config.ts';
const formatName = (server: Server) =>
  `${server.name[0].toUpperCase()}${server.name.slice(1).replace(/(\d)/, ' $1')}`;

export const urls = retired
  ? undefined
  : Object.fromEntries(
      instances
        .map((server) => [
          formatName(server),
          {
            public: interpolate`https://${server.fqdn}`,
            tailscale: server.tailscaleName,
          },
        ])
        .concat(
          patientPortalDomain && instances.some((server) => server.name === 'Central')
            ? [
                [
                  'Patient Portal',
                  {
                    public: interpolate`https://${patientPortalDomain}`,
                    tailscale: '(central)',
                  },
                ],
              ]
            : [],
        )
        .concat(
          instances
            .filter((inst) => inst.msupplyFqdn)
            .map((inst) => [
              `${formatName(inst)} mSupply`,
              {
                public: interpolate`https://${inst.msupplyFqdn}`,
                tailscale: inst.msupplyTailscaleName ?? inst.tailscaleName,
              },
            ]),
        ),
    );

export const redirectsTo =
  redirects.length === 0
    ? undefined
    : all(redirects.map(({ host, target }) => all([host, target]))).apply((entries) =>
        Object.fromEntries(entries),
      );
