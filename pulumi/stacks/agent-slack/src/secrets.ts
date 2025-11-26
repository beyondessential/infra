import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { namespace } from './namespace.ts';
import {
  slackBotToken,
  slackAppToken,
  slackSigningSecret,
  askAiChannelId,
  anthropicApiKey,
  googleDriveDocsFolderId,
  googleDriveLogsFolderId,
} from './config.ts';

export const secret = new k8s.core.v1.Secret('agent-slack-secrets', {
  metadata: {
    namespace,
    name: 'agent-slack-secrets',
  },
  stringData: {
    SLACK_BOT_TOKEN: slackBotToken,
    SLACK_APP_TOKEN: slackAppToken,
    SLACK_SIGNING_SECRET: slackSigningSecret,
    ASK_AI_CHANNEL_ID: askAiChannelId,
    ANTHROPIC_API_KEY: anthropicApiKey,
    GOOGLE_DRIVE_DOCS_FOLDER_ID: googleDriveDocsFolderId,
    GOOGLE_DRIVE_LOGS_FOLDER_ID: googleDriveLogsFolderId,
  },
});
