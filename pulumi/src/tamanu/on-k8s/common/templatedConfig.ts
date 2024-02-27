import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sClient } from '../../../common/k8s/client.js';
import { namespace } from '../namespace.js';
import nunjucks from 'nunjucks';
import { DEFAULT_CONFIG_TEMPLATE, configTemplate } from '../config.js';

export interface TemplatedConfigArgs {
  parent: ComponentResource;
  kind: string;
  template?: string;
  name: string;
  additionalData?: { [key: string]: string };
  templateData?: object;
}

const k8sApi = k8sClient(CoreV1Api);

async function getTemplate(kind: string, name: string) {
  try {
    return await k8sApi.readNamespacedConfigMap(`${kind}-template-${name}`, 'tamanu-system');
  } catch (_) {
    return await k8sApi.readNamespacedConfigMap(
      `${kind}-template-${DEFAULT_CONFIG_TEMPLATE}`,
      'tamanu-system',
    );
  }
}

export function templatedConfig({
  parent,
  kind,
  name,
  additionalData = {},
  templateData = {},
}: TemplatedConfigArgs): k8s.core.v1.ConfigMap {
  const templateName = `${kind}-template-${configTemplate}`;
  const original = getTemplate(kind, configTemplate);

  return new k8s.core.v1.ConfigMap(
    name,
    {
      metadata: {
        namespace,
        labels: {
          'bes.tamanu/templated-from': templateName,
        },
      },
      data: original.then((map) => ({
        ...Object.fromEntries(
          Object.entries(map.body.data ?? {}).map(([key, value]) => {
            if (key.endsWith('.njk') && typeof value === 'string') {
              return [key.slice(0, -4), nunjucks.renderString(value, templateData ?? {})];
            }

            return [key, value];
          }),
        ),
        ...additionalData,
      })),
      binaryData: original.then((map) => map.body.binaryData ?? {}),
    },
    { parent, ignoreChanges: ['data', 'binaryData'] },
  );
}
