import { addAddon } from '../cluster.ts';

addAddon('eks-node-monitoring-agent', {
  purpose: 'system',
  resolveConflicts: 'PRESERVE',
});
