import * as aws from '@pulumi/aws-native';
import { interpolate, jsonStringify, type Output } from '@pulumi/pulumi';
import {
  canopyInfra,
  domain,
  extraZoneImports,
  extraZones,
  tags as configTags,
  zoneImport,
} from './config.ts';
import { CrossStack } from '../../common/CrossStack.ts';
import { nativeTags } from '../../common/tags.ts';

const CANOPY_RECORD_TYPES = ['A', 'AAAA', 'TXT'];

// A zone's name may or may not carry a trailing dot, which confuses Pulumi into
// recreating it. The rest is whatever the zone was created with elsewhere: a
// comment, VPC associations, recovery features with read-only fields. The same
// list applies whether or not the zone is being imported, so that removing the
// import option after the first apply does not turn those into pending changes.
const ZONE_IGNORE_CHANGES = [
  'name',
  'vpcs',
  'hostedZoneConfig',
  'hostedZoneFeatures',
  'description',
];

let zone: aws.route53.HostedZone | undefined;
let policy: aws.iam.ManagedPolicy | undefined;
let canopyDnsRole: aws.iam.Role | undefined;
let user: aws.iam.User | undefined;
// spec: CORE#zone
if (domain) {
  zone = new aws.route53.HostedZone(
    domain,
    {
      name: `${domain}.`,
    },
    { import: zoneImport, ignoreChanges: ZONE_IGNORE_CHANGES },
  );

  // spec: CORE#zone
  // Attached from the identity side (the acme-dns IAM users name it in their own
  // managedPolicyArns), so the attachment has to be ignored here or a refresh
  // reads it back and CloudFormation detaches it.
  policy = new aws.iam.ManagedPolicy(
    'core-domain-mgmt',
    {
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
    },
    { ignoreChanges: ['users', 'roles', 'groups'] },
  );
}

// spec: CORE#outputs
export const zoneId = zone?.id;
export const zoneNS = zone?.nameServers;
export const zoneMgmtPolicy = policy?.policyArn;

// spec: CORE#zone
const extraZoneResources = extraZones.map(
  (name) =>
    new aws.route53.HostedZone(
      name,
      { name: `${name}.` },
      { import: extraZoneImports[name], ignoreChanges: ZONE_IGNORE_CHANGES },
    ),
);

export const extraZoneIds: { [domain: string]: Output<string> } = Object.fromEntries(
  extraZones.map((name, i) => [name, extraZoneResources[i].id]),
);
export const extraZoneNS: { [domain: string]: Output<string[]> } = Object.fromEntries(
  extraZones.map((name, i) => [name, extraZoneResources[i].nameServers]),
);

// Canopy holds the zone access no server holds: it publishes the addresses of
// the names a group's servers register, and the challenge records that prove
// control of those names. It runs in the central account and reaches the zones
// of this account by assuming this role, so the trust policy below is the
// effective gate — and Canopy's own side needs `sts:AssumeRole` besides (see
// canopy-infra). One role covers every zone of the account, primary and extra.
//
// Gated on the ref: a stack that has not been pointed at Canopy gets no role,
// and its zones stay reachable only by the stack's own identities.
// spec: CTLS#zone-access
const canopyZoneIds: Output<string>[] = [
  ...(zone ? [zone.id] : []),
  ...extraZones.map((name) => extraZoneIds[name]),
];
if (canopyInfra && canopyZoneIds.length > 0) {
  const canopyDomainsRoleArn = new CrossStack(canopyInfra).get<string>('canopyDomainsRoleArn');
  const tags = nativeTags(configTags, { Purpose: 'canopy-dns', ManagedBy: 'pulumi' });
  const zoneArns = canopyZoneIds.map((id) => interpolate`arn:aws:route53:::hostedzone/${id}`);
  const apexes = [...(domain ? [domain] : []), ...extraZones].join(', ');

  canopyDnsRole = new aws.iam.Role('canopy-dns', {
    description: `Let Canopy write the records it manages in ${apexes}`,
    assumeRolePolicyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: canopyDomainsRoleArn },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
    managedPolicyArns: [
      new aws.iam.ManagedPolicy(
        'canopy-dns',
        {
          description: `Write the records Canopy manages in ${apexes}`,
          policyDocument: jsonStringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'route53:ChangeResourceRecordSets',
                Resource: zoneArns.length === 1 ? zoneArns[0] : zoneArns,
                Condition: {
                  'ForAllValues:StringEquals': {
                    'route53:ChangeResourceRecordSetsRecordTypes': CANOPY_RECORD_TYPES,
                  },
                },
              },
            ],
          }),
        },
        { ignoreChanges: ['users', 'roles', 'groups'] },
      ).policyArn,
    ],
    tags,
  });
}

export const canopyDnsRoleArn = canopyDnsRole?.arn;
