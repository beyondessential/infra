import { interpolate, output } from '@pulumi/pulumi';

import { domainBase, instances, patientPortalDomain } from './config.ts';
import { failIfIncorrectAccount } from '../../../common/coreRef.ts';
failIfIncorrectAccount();

import './backup/aws.ts';
import './firewall.ts';
import './instances.ts';

export { backupBucket, backupReadOnlyUser, backupUsers } from './backup/kopia.ts';
export { acmeDnsUsers } from './acme-dns.ts';

export { tailscaleTags } from './config.ts';
export const urls = Object.fromEntries(
  instances
    .map((server) => [
      `${server.name[0].toUpperCase()}${server.name.slice(1).replace(/(\d)/, ' $1')}`,
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
    ),
);
