import './passwords.ts';
import './ebs-encryption.ts';
import './cloudtrail.ts';

import { v4, v6 as ipv6 } from './config.ts';
const ipv4 = Boolean(v4);
export { ipv4, ipv6 };

export { accountId, region } from '../../common/awsAccount.ts';
export { tags, domain as zoneName } from './config.ts';
export { ghaOidc } from './oidc.ts';
export { eksCniV6Policy } from './policy.ts';
export { network, dbSubnetGroup } from './network.ts';
export { zoneId, zoneNS, zoneMgmtPolicy, canopyDnsRoleArn } from './zone.ts';
export { spotDataFeed } from './spot-data-feed.ts';
export { alertsTopicArn } from './alerts.ts';
