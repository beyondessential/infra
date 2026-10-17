import { camelCase, upperFirst } from 'lodash-es';
import { all, getStack } from '@pulumi/pulumi';
import { CrossStack } from './CrossStack.ts';
import { nativeTags as tagsToNative } from './tags.ts';
import { accountId } from './awsAccount.ts';
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
export { region } from './awsAccount.ts';

// spec: CORE#account
export function failIfIncorrectAccount(): void {
  all([$core.get('accountId'), accountId]).apply(([coreAccountId, accountId]) => {
    if (coreAccountId !== accountId) {
      throw new Error(`Incorrect account: expected ${coreAccountId} but got ${accountId}`);
    }
  });
}
