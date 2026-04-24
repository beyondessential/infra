import { interpolate, output } from '@pulumi/pulumi';

import { domainBase, instances, patientPortalDomain, type Server } from './config.ts';
import { failIfIncorrectAccount } from '../../../common/coreRef.ts';
failIfIncorrectAccount();

import './backup/aws.ts';
import './firewall.ts';
import './instances.ts';

export { backupBucket, backupReadOnlyUser, backupUsers } from './backup/kopia.ts';
export { acmeDnsUsers } from './acme-dns.ts';

export { tailscaleTags } from './config.ts';
const formatName = (server: Server) =>
  `${server.name[0].toUpperCase()}${server.name.slice(1).replace(/(\d)/, ' $1')}`;

export const urls = Object.fromEntries(
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
