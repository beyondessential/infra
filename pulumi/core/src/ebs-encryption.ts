import * as awsClassic from '@pulumi/aws';

// spec: CORE#account-baseline
// Enable EBS encryption by default for this region
export const ebsEncryptionByDefault = new awsClassic.ebs.EncryptionByDefault(
  'ebs-encryption-default',
  {
    enabled: true,
  },
);

// Set the default KMS key for EBS encryption (uses AWS-managed key if not specified)
export const ebsDefaultKmsKeyId = new awsClassic.ebs.DefaultKmsKey('ebs-default-kms-key', {
  keyArn: awsClassic.kms.getKeyOutput({
    keyId: 'alias/aws/ebs',
  }).arn,
});
