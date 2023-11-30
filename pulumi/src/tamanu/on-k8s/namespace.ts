import { getStack } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

const ns = new k8s.core.v1.Namespace(`tamanu-${getStack()}`);

export const namespace = ns.metadata.name;
