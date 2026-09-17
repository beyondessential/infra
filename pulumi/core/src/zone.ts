import * as aws from '@pulumi/aws-native';
import { domain, extraZones, zoneImport } from './config.ts';
import { interpolate, type Output } from '@pulumi/pulumi';

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

// Sibling zones created alongside the primary. Keyed by domain so their IDs and
// nameservers can be read from stack outputs (the latter feed the by-hand NS
// delegation in the parent zone).
const extraZoneResources = extraZones.map(
  (name) =>
    new aws.route53.HostedZone(
      name,
      { name: `${name}.` },
      { ignoreChanges: ['name', 'description'] },
    ),
);

export const extraZoneIds: { [domain: string]: Output<string> } = Object.fromEntries(
  extraZones.map((name, i) => [name, extraZoneResources[i].id]),
);
export const extraZoneNS: { [domain: string]: Output<string[]> } = Object.fromEntries(
  extraZones.map((name, i) => [name, extraZoneResources[i].nameServers]),
);
