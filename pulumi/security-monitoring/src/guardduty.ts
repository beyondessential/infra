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
  AI_PROTECTION: 'NONE',
  RUNTIME_MONITORING: 'NONE',
  EKS_RUNTIME_MONITORING: 'NONE',
};

export const detectorIds: Record<string, Output<string>> = {};

for (const region of findingRegions) {
  const provider = regionProviders[region];
  const existingDetectorId = existingDetectorIds[region];

  const adminAccount = new aws.guardduty.OrganizationAdminAccount(
    `org-admin-${region}`,
    {
      adminAccountId: AWS_PRIMARY_ACCOUNT_ID,
    },
    { provider, import: existingDetectorId ? AWS_PRIMARY_ACCOUNT_ID : undefined },
  );

  // No tags: the live ap-southeast-2 detector has none, and import requires inputs to
  // match the existing resource exactly.
  const detector = new aws.guardduty.Detector(
    `detector-${region}`,
    {
      enable: true,
      findingPublishingFrequency,
    },
    { provider, import: existingDetectorId },
  );

  const organizationConfiguration = new aws.guardduty.OrganizationConfiguration(
    `org-config-${region}`,
    {
      detectorId: detector.id,
      autoEnableOrganizationMembers: 'ALL',
    },
    { provider, import: existingDetectorId, dependsOn: [adminAccount] },
  );

  for (const [name, autoEnable] of Object.entries(ORGANISATION_FEATURES)) {
    new aws.guardduty.OrganizationConfigurationFeature(
      `org-feature-${region}-${name.toLowerCase().replaceAll('_', '-')}`,
      {
        detectorId: detector.id,
        name,
        autoEnable,
      },
      { provider, dependsOn: [organizationConfiguration] },
    );
  }

  detectorIds[region] = detector.id;
}
