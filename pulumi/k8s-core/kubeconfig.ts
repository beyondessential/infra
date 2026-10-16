import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { Provider } from '@pulumi/kubernetes';
import { stackName } from '../common/coreRef.ts';
import { cluster, liveCluster } from './cluster.ts';

// Endpoint, CA, and auth come from the live cluster lookup, not the Cluster
// resource's outputs: pending Cluster updates would otherwise cascade into a
// planned replacement of this provider and of every resource it manages.
const auth = awsClassic.eks.getClusterAuthOutput({ name: stackName }, { dependsOn: [cluster] });

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
        'certificate-authority-data': liveCluster.certificateAuthorities.apply((cas) => cas[0].data),
        server: liveCluster.endpoint,
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
  // deleteUnreachable: true,
});
