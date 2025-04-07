import { interpolate } from '@pulumi/pulumi';

import { instances } from './config.js';
import { failIfIncorrectAccount } from '../../common/coreRef.js';
failIfIncorrectAccount();

import './backup/aws.js';
import './firewall.js';
import './instances.js';

export { backupBucket, backupUsers } from './backup/kopia.js';

export { tailscaleTags } from './config.js';
export const urls = Object.fromEntries(
  instances.map((server) => [
    `${server.name[0].toUpperCase()}${server.name.slice(1).replace(/(\d)/, ' $1')}`,
    {
      public: interpolate`https://${server.fqdn}`,
      tailscale: server.tailscaleName,
    },
  ]),
);
