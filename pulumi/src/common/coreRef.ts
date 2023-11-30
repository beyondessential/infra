import { camelCase, upperFirst } from 'lodash-es';
import { Config, getStack } from '@pulumi/pulumi';
import { CrossStack } from './CrossStack.js';
import { nativeTags as tagsToNative } from './tags.js';

export const cfg = new Config();

export const $core = new CrossStack(cfg.require('core'));
export const $network = $core.network();

export const tags = $core.tags();
export const nativeTags = tagsToNative(tags);

export const coreStackName = $core.name.split('/')[2];
export const stackName = getStack().replace(new RegExp(`^${coreStackName}-`), '');
export const pascalStackName = upperFirst(camelCase(stackName));

export const ghaOidc = $core.ghaOidc();
