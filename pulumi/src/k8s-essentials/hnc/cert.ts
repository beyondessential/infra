import * as k8s from '@pulumi/kubernetes';
import { namespace, ns } from './namespace.ts';

const issuer = new k8s.apiextensions.CustomResource(
  'hnc-issuer',
  {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Issuer',
    metadata: {
      namespace,
    },
    spec: {
      selfSigned: {},
    },
  },
  { parent: ns },
);

export const SERVING_CERT_SECRET_NAME = 'webhook-server-cert';
export const servingCert = new k8s.apiextensions.CustomResource(
  'hnc-serving-cert',
  {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: {
      namespace,
    },
    spec: {
      commonName: 'hnc-webhook-service.hnc-system.svc',
      dnsNames: [
        'hnc-webhook-service.hnc-system.svc.cluster.local',
        'hnc-webhook-service.hnc-system.svc',
      ],
      issuerRef: {
        kind: 'Issuer',
        name: issuer.metadata.name,
      },
      secretName: SERVING_CERT_SECRET_NAME,
    },
  },
  { parent: ns },
);
