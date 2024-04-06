import { randomBytes } from 'node:crypto';
import { ComponentResource, Output, all, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api, V1ConfigMap } from '@kubernetes/client-node';
import nunjucks from 'nunjucks';
import { k8sClient } from '../../../common/k8s/client.js';
import { namespace } from '../namespace.js';
import { DEFAULT_CONFIG_TEMPLATE, configTemplate } from '../config.js';
import { $network } from '../../../common/k8s/coreRef.js';

export interface TemplatedConfigArgs {
  parent: ComponentResource;
  kind: string;
  template?: string;
  name: string;
  additionalData?: { [key: string]: string };
  templateData?: object;
}

const k8sApi = k8sClient(CoreV1Api);

function getTemplate(kind: string, name: string): Output<V1ConfigMap> {
  return output(
    (async () => {
      try {
        return (await k8sApi.readNamespacedConfigMap(`${kind}-template-${name}`, 'tamanu-system'))
          .body;
      } catch (_) {
        console.log(
          `Wanted template ${name} isn't available, falling back to ${DEFAULT_CONFIG_TEMPLATE}`,
        );
        return (
          await k8sApi.readNamespacedConfigMap(
            `${kind}-template-${DEFAULT_CONFIG_TEMPLATE}`,
            'tamanu-system',
          )
        ).body;
      }
    })(),
  );
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
  const templater = new nunjucks.Environment();
  templater.addFilter(
    'randomstring',
    (length: number, format: 'hex' | 'base64' | 'base64url' = 'hex') =>
      randomBytes(length).toString(format),
  );

  return new k8s.core.v1.ConfigMap(
    name,
    {
      metadata: {
        namespace,
        labels: {
          'bes.tamanu/templated-from': templateName,
        },
      },
      data: all([original, $network]).apply(([map, network]) => ({
        ...Object.fromEntries(
          Object.entries(map.data ?? {}).map(([key, value]) => {
            if (key.endsWith('.njk') && typeof value === 'string') {
              key = key.slice(0, -4);
              value = templater.renderString(value, {
                ...(templateData ?? {}),
                networkV4Cidr: network.v4Cidr,
                networkV6Cidr: network.v6Cidr,
              });
            }

            return [key, value];
          }),
        ),
        ...additionalData,
      })),
      binaryData: original.apply((map) => map.binaryData ?? {}),
    },
    { parent, ignoreChanges: ['data', 'binaryData'] },
  );
}
