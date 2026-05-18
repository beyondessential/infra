import { addAddon } from '../cluster.ts';
import { withBootstrap } from './groups.ts';

addAddon(
  'eks-node-monitoring-agent',
  {
    purpose: 'system',
    resolveConflicts: 'PRESERVE',
  },
  { dependsOn: withBootstrap() },
);
