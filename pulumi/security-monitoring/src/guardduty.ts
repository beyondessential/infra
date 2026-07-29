import type { Output } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { AWS_PRIMARY_ACCOUNT_ID } from '../../constants/internal.ts';
import { existingDetectorIds, findingPublishingFrequency, findingRegions } from './config.ts';
import { regionProviders } from './providers.ts';

// Mirrors what is already enabled organisation-wide, so applying this stack does not
// change which features member accounts are billed for. EKS_AUDIT_LOGS in particular
// dominates the bill and should only move as a deliberate decision.
const ORGANISATION_FEATURES: Record<string, 'ALL' | 'NONE'> = {
  EKS_AUDIT_LOGS: 'ALL',
  LAMBDA_NETWORK_LOGS: 'ALL',
  RDS_LOGIN_EVENTS: 'ALL',
  S3_DATA_EVENTS: 'ALL',
  EBS_MALWARE_PROTECTION: 'NONE',
  RUNTIME_MONITORING: 'NONE',
  EKS_RUNTIME_MONITORING: 'NONE',
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

  const organizationConfiguration = new aws.guardduty.OrganizationConfiguration(
    `org-config-${region}`,
    {
      detectorId: detector.id,
      autoEnableOrganizationMembers: 'ALL',
    },
    { provider, retainOnDelete, import: existingDetectorId, dependsOn: [adminAccount] },
  );

  for (const [name, autoEnable] of Object.entries(ORGANISATION_FEATURES)) {
    new aws.guardduty.OrganizationConfigurationFeature(
      `org-feature-${region}-${name.toLowerCase().replaceAll('_', '-')}`,
      {
        detectorId: detector.id,
        name,
        autoEnable,
      },
      { provider, retainOnDelete, dependsOn: [organizationConfiguration] },
    );
  }

  detectorIds[region] = detector.id;
}
