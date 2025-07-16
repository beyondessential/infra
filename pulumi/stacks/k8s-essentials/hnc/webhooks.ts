// Converted from HNC v1.1.0 default-cm.yaml
import * as k8s from '@pulumi/kubernetes';
import { interpolate } from '@pulumi/pulumi';
import { controlPlaneLabels, namespace, ns } from './namespace.ts';
import { servingCert } from './cert.ts';
import { hncSpec } from './specs.ts';

const webhooksLabels = {
  'control-plane': 'controller-webhooks',
};

const webhookService = new k8s.core.v1.Service(
  'hnc-webhook-service',
  {
    metadata: {
      name: 'hnc-webhook-service',
      namespace,
    },
    spec: {
      ports: [
        {
          port: 443,
          targetPort: 9443,
        },
      ],
      selector: webhooksLabels,
    },
  },
  { parent: ns },
);

new k8s.apps.v1.Deployment(
  'hnc-controller-webhooks',
  {
    metadata: {
      labels: controlPlaneLabels,
      name: 'hnc-controller-webhooks',
      namespace,
    },
    spec: {
      replicas: 2,
      selector: {
        matchLabels: webhooksLabels,
      },
      template: {
        metadata: {
          annotations: {
            'prometheus.io/scrape': 'true',
          },
          labels: webhooksLabels,
        },
        spec: hncSpec(['--webhooks-only'], webhooksLabels),
      },
    },
  },
  { parent: ns, dependsOn: [servingCert] },
);

new k8s.admissionregistration.v1.MutatingWebhookConfiguration(
  'hnc-mutating-webhook-configuration',
  {
    metadata: {
      annotations: {
        'cert-manager.io/inject-ca-from': interpolate`${namespace}/${servingCert.metadata.name}`,
      },
      name: 'hnc-mutating-webhook-configuration',
    },
    webhooks: [
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/mutate-namespace',
          },
        },
        failurePolicy: 'Ignore',
        name: 'namespacelabel.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: [''],
            apiVersions: ['v1'],
            operations: ['CREATE', 'UPDATE'],
            resources: ['namespaces'],
          },
        ],
        sideEffects: 'None',
      },
    ],
  },
  { parent: ns },
);

new k8s.admissionregistration.v1.ValidatingWebhookConfiguration(
  'hnc-validating-webhook-configuration',
  {
    metadata: {
      annotations: {
        'cert-manager.io/inject-ca-from': interpolate`${namespace}/${servingCert.metadata.name}`,
      },
      name: 'hnc-validating-webhook-configuration',
    },
    webhooks: [
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-hnc-x-k8s-io-v1alpha2-subnamespaceanchors',
          },
        },
        failurePolicy: 'Fail',
        name: 'subnamespaceanchors.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: ['hnc.x-k8s.io'],
            apiVersions: ['v1alpha2'],
            operations: ['CREATE', 'UPDATE', 'DELETE'],
            resources: ['subnamespaceanchors'],
          },
        ],
        sideEffects: 'None',
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-hnc-x-k8s-io-v1alpha2-hierarchyconfigurations',
          },
        },
        failurePolicy: 'Fail',
        name: 'hierarchyconfigurations.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: ['hnc.x-k8s.io'],
            apiVersions: ['v1alpha2'],
            operations: ['CREATE', 'UPDATE'],
            resources: ['hierarchyconfigurations'],
          },
        ],
        sideEffects: 'None',
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-objects',
          },
        },
        failurePolicy: 'Fail',
        name: 'objects.hnc.x-k8s.io',
        namespaceSelector: {
          matchLabels: {
            'hnc.x-k8s.io/included-namespace': 'true',
          },
        },
        rules: [
          {
            apiGroups: ['*'],
            apiVersions: ['*'],
            operations: ['CREATE', 'UPDATE', 'DELETE'],
            resources: ['*'],
            scope: 'Namespaced',
          },
        ],
        sideEffects: 'None',
        timeoutSeconds: 2,
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-hnc-x-k8s-io-v1alpha2-hncconfigurations',
          },
        },
        failurePolicy: 'Fail',
        name: 'hncconfigurations.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: ['hnc.x-k8s.io'],
            apiVersions: ['v1alpha2'],
            operations: ['CREATE', 'UPDATE', 'DELETE'],
            resources: ['hncconfigurations'],
          },
        ],
        sideEffects: 'None',
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-v1-namespace',
          },
        },
        failurePolicy: 'Fail',
        name: 'namespaces.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: [''],
            apiVersions: ['v1'],
            operations: ['DELETE', 'CREATE', 'UPDATE'],
            resources: ['namespaces'],
          },
        ],
        sideEffects: 'None',
      },
    ],
  },
  { parent: ns },
);
