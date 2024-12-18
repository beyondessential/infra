import { v4, v6 as ipv6 } from './config.js';
const ipv4= Boolean(v4);
export { ipv4, ipv6 };

export { accountId } from '../common/awsAccount.js';
export { ghaOidc } from './oidc.js';
export { eksCniV6Policy } from './policy.js';
export { network, dbSubnetGroup } from './network.js';
