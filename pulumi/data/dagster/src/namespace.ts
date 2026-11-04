import * as k8s from '@pulumi/kubernetes';
import { name } from './config.ts';

const ns = new k8s.core.v1.Namespace(
  name,
  {
    metadata: { name },
  },
  // Named `<name>-super` when the namespace was the root of an HNC tree.
  { ignoreChanges: ['metadata.name'], aliases: [{ name: `${name}-super` }] },
);

export const namespace = ns.metadata.name;
