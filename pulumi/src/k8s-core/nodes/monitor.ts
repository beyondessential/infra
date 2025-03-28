import { addAddon } from '../cluster.js';

addAddon('eks-node-monitoring-agent', {
  purpose: 'system',
  resolveConflicts: 'PRESERVE',
});
