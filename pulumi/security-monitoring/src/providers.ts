import * as aws from '@pulumi/aws';
import { chatbotRegion, findingRegions } from './config.ts';

export const regionProviders = Object.fromEntries(
  findingRegions.map((region) => [region, new aws.Provider(`aws-${region}`, { region })]),
);

export const chatbotProvider = new aws.Provider(`aws-${chatbotRegion}`, { region: chatbotRegion });
