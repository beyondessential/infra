import * as awsNative from '@pulumi/aws-native';
import { jsonStringify } from '@pulumi/pulumi';
import { instances, zoneId } from './config.ts';

const tags = [
  {
    key: 'Purpose',
    value: 'tamanu-acme-dns',
  },
  {
    key: 'ManagedBy',
    value: 'pulumi',
  },
];

const acmeDnsReadPolicy = new awsNative.iam.ManagedPolicy(
  'acme-dns-route53-policy',
  {
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['route53:ListHostedZones', 'route53:ListHostedZonesByName', 'route53:GetChange'],
          Resource: ['*'],
        },
      ],
    }),
  },
  { ignoreChanges: ['users'] },
);

// Policy for future dns-persist-01 support (not yet attached to any users).
// See https://letsencrypt.org/2026/02/18/dns-persist-01.html
// When caddy gains support, attach this to the relevant users and add the
// read policy as well.
export const acmeDnsPersistPolicy = instances
  .filter((inst) => inst.external && inst.externalIps && inst.externalIps.length > 0)
  .map((inst) => {
    return new awsNative.iam.ManagedPolicy(
      `acme-dns-persist-policy-${inst.id}`,
      {
        policyDocument: jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['route53:ChangeResourceRecordSets'],
              Resource: zoneId.apply((id) => `arn:aws:route53:::hostedzone/${id}`),
              Condition: {
                'ForAllValues:StringLike': {
                  'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
                    inst.fqdn.apply((fqdn) => `_validation-persist.${fqdn}`),
                  ],
                  'route53:ChangeResourceRecordSetsRecordTypes': ['TXT'],
                },
              },
            },
            {
              Effect: 'Allow',
              Action: ['route53:ListResourceRecordSets'],
              Resource: zoneId.apply((id) => `arn:aws:route53:::hostedzone/${id}`),
            },
          ],
        }),
      },
      { ignoreChanges: ['users'] },
    );
  });

export const acmeDnsUsers = instances
  .filter((inst) => inst.external && inst.externalIps && inst.externalIps.length > 0)
  .map((inst) => {
    const user = new awsNative.iam.User(
      `tamanu-acme-dns-${inst.id}`,
      {
        tags,
        managedPolicyArns: [acmeDnsReadPolicy.policyArn],
      },
      { parent: acmeDnsReadPolicy },
    );

    new awsNative.iam.UserPolicy(
      `acme-dns-change-policy-${inst.id}`,
      {
        userName: user.userName,
        policyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['route53:ChangeResourceRecordSets'],
              Resource: zoneId.apply((id) => `arn:aws:route53:::hostedzone/${id}`),
              Condition: {
                'ForAllValues:StringLike': {
                  'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
                    inst.fqdn.apply((fqdn) => `_acme-challenge.${fqdn}`),
                  ],
                  'route53:ChangeResourceRecordSetsRecordTypes': ['TXT'],
                },
              },
            },
            {
              Effect: 'Allow',
              Action: ['route53:ListResourceRecordSets'],
              Resource: zoneId.apply((id) => `arn:aws:route53:::hostedzone/${id}`),
            },
          ],
        },
      },
      { parent: user },
    );

    return user.userName;
  });
