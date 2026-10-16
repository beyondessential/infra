import type { Output } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { AWS_PRIMARY_ACCOUNT_ID } from '../../constants/internal.ts';
import {
  existingDetectorIds,
  findingPublishingFrequency,
  findingRegions,
  regionAccounts,
} from './config.ts';
import { regionProviders } from './providers.ts';

// guardduty.Member requires each account's email, which only Organizations knows.
const accountEmails = aws.organizations
  .getOrganizationOutput()
  .accounts.apply((accounts) => Object.fromEntries(accounts.map(({ id, email }) => [id, email])));

const accountEmail = (accountId: string) =>
  accountEmails.apply((emails) => {
    const email = emails[accountId];
    if (!email) {
      throw new Error(`security-monitoring: ${accountId} is not an account in this organisation`);
    }
    return email;
  });

// Mirrors what is already enabled organisation-wide, so applying this stack does not
// change which features member accounts are billed for. EKS_AUDIT_LOGS in particular
// dominates the bill and should only move as a deliberate decision.
// The runtime-monitoring features carry nested toggles that GuardDuty always reports.
// They have to be declared, or every refresh sees them as drift and — since the field
// forces replacement — proposes replacing the feature on every run.
const ORGANISATION_FEATURES: Record<string, { autoEnable: 'ALL' | 'NONE'; additional?: string[] }> =
  {
    EKS_AUDIT_LOGS: { autoEnable: 'ALL' },
    LAMBDA_NETWORK_LOGS: { autoEnable: 'ALL' },
    RDS_LOGIN_EVENTS: { autoEnable: 'ALL' },
    S3_DATA_EVENTS: { autoEnable: 'ALL' },
    EBS_MALWARE_PROTECTION: { autoEnable: 'NONE' },
    RUNTIME_MONITORING: {
      autoEnable: 'NONE',
      additional: ['ECS_FARGATE_AGENT_MANAGEMENT', 'EC2_AGENT_MANAGEMENT', 'EKS_ADDON_MANAGEMENT'],
    },
    EKS_RUNTIME_MONITORING: { autoEnable: 'NONE', additional: ['EKS_ADDON_MANAGEMENT'] },
  };

// AI_PROTECTION is reported by the API but is not yet in the provider's accepted set of
// feature names, so it stays unmanaged. It is currently NONE everywhere, which is the
// value this stack would have set anyway.

// Destroying this stack must never dismantle organisation-wide threat detection. These
// resources are all retained on delete: `pulumi destroy` drops them from state and
// leaves AWS untouched, so tearing down the delivery path cannot take detection with
// it. Without this, deleting OrganizationAdminAccount disassociates every member
// account, and deleting a Detector destroys that region's finding history.
//
// The consequence to know about: because delete is never called, a change that forces
// replacement (in practice only moving the delegated administrator to a different
// account) would abandon the old resource rather than clean it up. Do that by hand.
const retainOnDelete = true;

export const detectorIds: Record<string, Output<string>> = {};

for (const region of findingRegions) {
  const provider = regionProviders[region];
  const existingDetectorId = existingDetectorIds[region];

  const adminAccount = new aws.guardduty.OrganizationAdminAccount(
    `org-admin-${region}`,
    {
      adminAccountId: AWS_PRIMARY_ACCOUNT_ID,
    },
    {
      provider,
      retainOnDelete,
      import: existingDetectorId ? AWS_PRIMARY_ACCOUNT_ID : undefined,
    },
  );

  // No tags: the live ap-southeast-2 detector has none, and import requires inputs to
  // match the existing resource exactly.
  const detector = new aws.guardduty.Detector(
    `detector-${region}`,
    {
      enable: true,
      findingPublishingFrequency,
    },
    { provider, retainOnDelete, import: existingDetectorId },
  );

  // A restricted region must not auto-enable the whole organisation; its members are
  // named explicitly below instead.
  const onlyAccounts = regionAccounts[region];

  const organizationConfiguration = new aws.guardduty.OrganizationConfiguration(
    `org-config-${region}`,
    {
      detectorId: detector.id,
      autoEnableOrganizationMembers: onlyAccounts ? 'NONE' : 'ALL',
    },
    { provider, retainOnDelete, import: existingDetectorId, dependsOn: [adminAccount] },
  );

  for (const memberAccountId of onlyAccounts ?? []) {
    new aws.guardduty.Member(
      `member-${region}-${memberAccountId}`,
      {
        detectorId: detector.id,
        accountId: memberAccountId,
        email: accountEmail(memberAccountId),
        // Accounts already in the organisation are associated directly; an invitation
        // is only for accounts outside it.
        invite: false,
      },
      {
        provider,
        retainOnDelete,
        dependsOn: [organizationConfiguration],
        // Both are create-time inputs GuardDuty does not report back comparably, and
        // email forces replacement — without this, every refresh proposes replacing
        // all six members, which would disassociate and re-add them.
        ignoreChanges: ['email', 'invite'],
      },
    );
  }

  for (const [name, { autoEnable, additional }] of Object.entries(ORGANISATION_FEATURES)) {
    new aws.guardduty.OrganizationConfigurationFeature(
      `org-feature-${region}-${name.toLowerCase().replaceAll('_', '-')}`,
      {
        detectorId: detector.id,
        name,
        autoEnable,
        additionalConfigurations: additional?.map((additionalName) => ({
          name: additionalName,
          autoEnable,
        })),
      },
      { provider, retainOnDelete, dependsOn: [organizationConfiguration] },
    );
  }

  detectorIds[region] = detector.id;
}
