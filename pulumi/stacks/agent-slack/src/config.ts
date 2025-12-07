import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/k8s/coreRef.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';

export const normalizedStack = `agent-slack-${getStack()}`
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

export const slackBotToken = cfg.requireSecret('slackBotToken');
export const slackAppToken = cfg.requireSecret('slackAppToken');
export const slackSigningSecret = cfg.requireSecret('slackSigningSecret');
export const askAiChannelId = cfg.require('askAiChannelId');

export const anthropicApiKey = cfg.requireSecret('anthropicApiKey');

export const googleDriveDocsFolderId = cfg.require('googleDriveDocsFolderId');
export const googleDriveLogsFolderId = cfg.require('googleDriveLogsFolderId');
export const googleDriveCredentialsJson = cfg.requireSecret('googleDriveCredentialsJson');

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/agent-slack:${imageTag}`;

export const replicas = cfg.getNumber('replicas') ?? 1;
export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const cpuRequest = cfg.get('cpuRequest') ?? '10m';
export const memoryRequest = cfg.get('memoryRequest') ?? '256Mi';
export const cpuLimit = cfg.get('cpuLimit');
export const memoryLimit = cfg.get('memoryLimit');
