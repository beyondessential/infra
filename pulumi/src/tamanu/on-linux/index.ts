import { interpolate } from '@pulumi/pulumi';

import { instances } from './config.js';
import { failIfIncorrectAccount } from '../../common/coreRef.js';
failIfIncorrectAccount();

import './backup.js';
import './firewall.js';
import './instances.js';

export const urls = Object.fromEntries(
  instances.map((server) => [
    `${server.name[0].toUpperCase()}${server.name.slice(1).replace(/(\d)/, ' $1')}`,
    {
      public: interpolate`https://${server.fqdn}`,
      tailscale: server.tailscaleName,
    },
  ]),
);
