import * as aws from '@pulumi/aws-native';
import { domain, zoneImport } from './config.js';

let zone: aws.route53.HostedZone | undefined;
if (domain) {
  zone = new aws.route53.HostedZone(
    domain,
    {
      name: `${domain}.`,
    },
    zoneImport
      ? {
          import: zoneImport,
          ignoreChanges: ['vpcs', 'hostedZoneConfig', 'description'],
        }
      : {
          ignoreChanges: ['description'],
        },
  );
}

export const zoneId = zone?.id;
export const zoneNS = zone?.nameServers;
