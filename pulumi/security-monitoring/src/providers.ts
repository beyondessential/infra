import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { region } from '../../common/awsAccount.ts';
import { findingRegions } from './config.ts';

export const regionProviders = Object.fromEntries(
  findingRegions.map((region) => [region, new aws.Provider(`aws-${region}`, { region })]),
);

// The email subscription is created with aws-native: the classic provider's email
// subscriptions proved unreliable here, while backup-monitoring's aws-native one has
// stayed confirmed. It needs an explicit provider because this stack sets only
// aws:region, not aws-native:region.
export const nativeProvider = new awsNative.Provider('aws-native-primary', {
  region: region as awsNative.Region,
});
