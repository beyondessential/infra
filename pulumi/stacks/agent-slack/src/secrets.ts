import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { namespace } from './namespace.ts';
import {
  slackBotToken,
  slackAppToken,
  slackSigningSecret,
  askAiChannelId,
  anthropicApiKey,
  cursorApiKey,
  googleDriveDocsFolderId,
  googleDriveLogsFolderId,
  googleDriveCredentialsJson,
  imagePullPat,
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
    CURSOR_API_KEY: cursorApiKey,
    GOOGLE_DRIVE_DOCS_FOLDER_ID: googleDriveDocsFolderId,
    GOOGLE_DRIVE_LOGS_FOLDER_ID: googleDriveLogsFolderId,
  },
});

export const credentialsSecret = new k8s.core.v1.Secret('google-drive-credentials', {
  metadata: {
    namespace,
    name: 'google-drive-credentials',
  },
  stringData: {
    'credentials.json': googleDriveCredentialsJson,
  },
});

export const registrySecret = new k8s.core.v1.Secret("registry-secret", {
    metadata: {
        namespace,
    },
    type: "kubernetes.io/dockerconfigjson",
    stringData: {
        ".dockerconfigjson": pulumi.jsonStringify({
            auths: {
                "https://ghcr.io": {
                    auth: imagePullPat.apply(pat => Buffer.from(`passcod:${pat}`).toString('base64')),
                },
            },
        }),
    },
});
