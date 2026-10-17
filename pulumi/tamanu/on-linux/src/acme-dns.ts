import * as awsNative from '@pulumi/aws-native';
import { all, jsonStringify, type Output } from '@pulumi/pulumi';
import { billingTags, instances, patientPortalDomain, zoneId } from './config.ts';
import { nativeTags } from '../../../common/tags.ts';

const tags = nativeTags(
  {
    Purpose: 'tamanu-acme-dns',
    ManagedBy: 'pulumi',
  },
  billingTags,
);

// spec: LNXAPP#certificates
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
    const fqdns: Output<string>[] = [inst.fqdn];
    if (inst.msupplyFqdn) fqdns.push(inst.msupplyFqdn);
    if (patientPortalDomain && inst.id === 'central') fqdns.push(patientPortalDomain);
    const persistNames = all(fqdns).apply((names) =>
      names.map((fqdn) => `_validation-persist.${fqdn}`),
    );

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
                  'route53:ChangeResourceRecordSetsNormalizedRecordNames': persistNames,
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

// spec: LNXAPP#certificates
export const acmeDnsUsers = instances
  .filter((inst) => inst.dnsUser || (inst.external && inst.externalIps && inst.externalIps.length > 0))
  .map((inst) => {
    const user = new awsNative.iam.User(
      `tamanu-acme-dns-${inst.id}`,
      {
        tags,
        managedPolicyArns: [acmeDnsReadPolicy.policyArn],
      },
      { parent: acmeDnsReadPolicy },
    );

    const fqdns: Output<string>[] = [inst.fqdn];
    if (inst.msupplyFqdn) fqdns.push(inst.msupplyFqdn);
    if (patientPortalDomain && inst.id === 'central') fqdns.push(patientPortalDomain);
    const challengeNames = all(fqdns).apply((names) =>
      names.map((fqdn) => `_acme-challenge.${fqdn}`),
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
                  'route53:ChangeResourceRecordSetsNormalizedRecordNames': challengeNames,
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
