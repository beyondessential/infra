import { camelCase, upperFirst } from 'lodash-es';
import { getCallerIdentity } from '@pulumi/aws';
import { getStack } from '@pulumi/pulumi';
import { CrossStack } from './CrossStack.ts';
import { nativeTags as tagsToNative } from './tags.ts';
import { region } from './awsAccount.ts';
import { cfg } from './cfg.ts';
export { cfg };

export const $core = new CrossStack(cfg.require('core'));
export const $network = $core.network();

export const tags = $core.tags();
export const nativeTags = tagsToNative(tags);

export const coreStackName = $core.name.split('/')[2];
export const stackName = getStack().replace(new RegExp(`^${coreStackName}-`), '');
export const pascalStackName = upperFirst(camelCase(stackName));

export const ghaOidc = $core.ghaOidc();
export const zone = $core.zone();
export const alertsTopicArn = $core.alertsTopicArn();
export { region };

// spec: CORE#account
// Awaited before any resource is declared, so a run against the wrong account or region
// fails the preview rather than the update.
export async function failIfIncorrectAccountOrRegion(): Promise<void> {
  const [coreAccountId, coreRegion, { accountId }] = await Promise.all([
    $core.getValue<string>('accountId'),
    $core.getValue<string>('region'),
    getCallerIdentity(),
  ]);
  if (coreAccountId !== accountId) {
    throw new Error(`Incorrect account: expected ${coreAccountId} but got ${accountId}`);
  }
  if (coreRegion !== region) {
    throw new Error(`Incorrect region: expected ${coreRegion} but got ${region}`);
  }
}
