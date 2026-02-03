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

const acmeDnsReadPolicy = new awsNative.iam.ManagedPolicy('acme-dns-route53-policy', {
  policyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['route53:ListHostedZones', 'route53:GetChange'],
        Resource: ['*'],
      },
    ],
  }),
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
          ],
        },
      },
      { parent: user },
    );

    return user.userName;
  });
