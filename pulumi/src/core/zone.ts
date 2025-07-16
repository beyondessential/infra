import * as aws from '@pulumi/aws-native';
import { domain, zoneImport } from './config.ts';
import { interpolate } from '@pulumi/pulumi';

let zone: aws.route53.HostedZone | undefined;
let policy: aws.iam.ManagedPolicy | undefined;
let user: aws.iam.User | undefined;
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
          // the zone may have a trailing dot or may not,
          // this confuses Pulumi and it tries to recreate the zone
          ignoreChanges: ['name', 'description'],
        },
  );

  policy = new aws.iam.ManagedPolicy('core-domain-mgmt', {
    description: `Read and write records for the core domain ${domain}`,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'route53:ListResourceRecordSets',
            'route53:GetChange',
            'route53:GetHostedZone',
            'route53:ChangeResourceRecordSets',
          ],
          Resource: [
            interpolate`arn:aws:route53:::hostedzone/${zone.id}`,
            'arn:aws:route53:::change/*',
          ],
        },
        {
          Effect: 'Allow',
          Action: ['route53:ListHostedZonesByName', 'route53:ListHostedZones'],
          Resource: '*',
        },
      ],
    },
  });
}

export const zoneId = zone?.id;
export const zoneNS = zone?.nameServers;
export const zoneMgmtPolicy = policy?.policyArn;
