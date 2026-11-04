import * as k8s from '@pulumi/kubernetes';
import { DAGSTER_SERVICE_ACCOUNT } from '../../../constants/dagster.ts';
import { namespace } from './namespace.ts';
import { roleArn } from './config.ts';

// spec: DAGS#aws-identity
// The chart creates no service account when it is given a name, so this one
// serves the webserver, the daemon, the code servers and the run pods alike.
new k8s.core.v1.ServiceAccount('dagster', {
  metadata: {
    name: DAGSTER_SERVICE_ACCOUNT,
    namespace,
    annotations: { 'eks.amazonaws.com/role-arn': roleArn },
  },
});
