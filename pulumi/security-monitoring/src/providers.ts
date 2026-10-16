import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { findingRegions } from './config.ts';

export const regionProviders = Object.fromEntries(
  findingRegions.map((region) => [region, new aws.Provider(`aws-${region}`, { region })]),
);

// Email subscriptions are created with aws-native: the classic provider's email
// subscriptions proved unreliable here, while backup-monitoring's aws-native one has
// stayed confirmed.
export const nativeRegionProviders = Object.fromEntries(
  findingRegions.map((region) => [
    region,
    new awsNative.Provider(`aws-native-${region}`, { region: region as awsNative.Region }),
  ]),
);
