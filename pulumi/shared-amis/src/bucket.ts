import * as awsClassic from '@pulumi/aws';
import { tags } from './config.ts';

export const staging = new awsClassic.s3.Bucket('staging', {
  bucketPrefix: 'bes-shared-amis-staging-',
  tags,
});

