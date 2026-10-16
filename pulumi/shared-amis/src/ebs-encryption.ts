import * as awsClassic from '@pulumi/aws';

// Public shared AMIs cannot carry snapshots encrypted with the account-default
// EBS key, so EBS encryption-by-default is kept OFF in this account/region.
// This is the inverse of the `core` stack, which enables it.
export const ebsEncryptionByDefault = new awsClassic.ebs.EncryptionByDefault(
  'ebs-encryption-default',
  {
    enabled: false,
  },
);
