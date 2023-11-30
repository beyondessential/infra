import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { Provider } from '@pulumi/kubernetes';
import { cluster, clusterName } from './cluster.js';

const auth = awsClassic.eks.getClusterAuthOutput({
  name: clusterName,
});

// This is a kubeconfig specifically for Pulumi to use internally, it's not
// suited to be used externally; use `aws eks update-kubeconfig --name ...`
export const kubeconfig = jsonStringify({
  apiVersion: 'v1',
  kind: 'Config',
  'current-context': 'context',
  clusters: [
    {
      name: 'cluster',
      cluster: {
        'certificate-authority-data': cluster.certificateAuthorityData,
        server: cluster.endpoint,
      },
    },
  ],
  contexts: [
    {
      name: 'context',
      context: {
        cluster: 'cluster',
        user: 'user',
      },
    },
  ],
  users: [
    {
      name: 'user',
      user: {
        token: auth.token,
      },
    },
  ],
});

export const provider = new Provider('kubernetes', {
  kubeconfig,
  deleteUnreachable: true,
});
