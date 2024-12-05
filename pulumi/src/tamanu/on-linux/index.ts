import { domains } from './config.js';
import { failIfIncorrectAccount } from '../../common/coreRef.js';
failIfIncorrectAccount();

import './backup.js';
import './firewall.js';
import './instances.js';

export const urls = Object.fromEntries(
  Object.entries(domains).map(([key, value]) => [
    `${key[0].toUpperCase()}${key.slice(1).replace(/(\d)/, ' $1')}`,
    `https://${value}`,
  ]),
);
