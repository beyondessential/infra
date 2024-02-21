import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { cfg } from '../../../common/k8s/coreRef.js';
import { k8sClient } from '../../../common/k8s/client.js';
import { namespace } from '../namespace.js';
import nunjucks from 'nunjucks';

export interface TemplatedConfigArgs {
  parent: ComponentResource;
  kind: string;
  template?: string;
  name: string;
  additionalData?: { [key: string]: string };
  templateData?: object;
}

const k8sApi = k8sClient(CoreV1Api);

export function templatedConfig({
  parent,
  kind,
  template = cfg.get(kind) ?? 'basic',
  name,
  additionalData = {},
  templateData = {},
}: TemplatedConfigArgs): k8s.core.v1.ConfigMap {
  const templateName = `${kind}-template-${template}`;
  const original = k8sApi.readNamespacedConfigMap(templateName, 'tamanu-system');

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
