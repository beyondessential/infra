import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { normalizedStack } from './config.ts';

const caRootIssuer = new k8s.apiextensions.CustomResource('ca-root-issuer', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Issuer',
  metadata: {
    namespace,
    name: 'ca-root',
  },
  spec: {
    selfSigned: {},
  },
});

export const caRootCert = new k8s.apiextensions.CustomResource('ca-root-certificate', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Certificate',
  metadata: {
    namespace,
    name: 'ca-root',
  },
  spec: {
    isCA: true,
    commonName: `root.${normalizedStack}`,
    secretName: 'ca-root',
    privateKey: {
      algorithm: 'ECDSA',
      size: 256,
    },
    issuerRef: {
      name: caRootIssuer.metadata.name,
      kind: caRootIssuer.kind,
      group: 'cert-manager.io',
    },
  },
});

export const caIssuer = new k8s.apiextensions.CustomResource('ca-issuer', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Issuer',
  metadata: {
    namespace,
    name: 'ca',
  },
  spec: {
    ca: {
      secretName: caRootCert.metadata.name,
    },
  },
});

new k8s.apiextensions.CustomResource('mtls-admin-certificate', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Certificate',
  metadata: {
    namespace,
    name: 'mtls-admin',
  },
  spec: {
    commonName: `admin.${normalizedStack}`,
    secretName: 'mtls-admin',
    privateKey: {
      algorithm: 'ECDSA',
      size: 256,
    },
    issuerRef: {
      name: caIssuer.metadata.name,
      kind: caIssuer.kind,
      group: 'cert-manager.io',
    },
  },
});

new k8s.apiextensions.CustomResource('mtls-releaser-certificate', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Certificate',
  metadata: {
    namespace,
    name: 'mtls-releaser',
  },
  spec: {
    commonName: `releaser.${normalizedStack}`,
    secretName: 'mtls-releaser',
    privateKey: {
      algorithm: 'ECDSA',
      size: 256,
    },
    issuerRef: {
      name: caIssuer.metadata.name,
      kind: caIssuer.kind,
      group: 'cert-manager.io',
    },
  },
});
