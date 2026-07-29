import * as aws from '@pulumi/aws';
import { findingRegions } from './config.ts';

export const regionProviders = Object.fromEntries(
  findingRegions.map((region) => [region, new aws.Provider(`aws-${region}`, { region })]),
);
