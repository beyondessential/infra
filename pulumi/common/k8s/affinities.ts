export const RUN_ON_SPOT = {
  matchExpressions: [
    {
      key: 'bes.node.schedule',
      operator: 'In',
      values: ['spot'],
    },
  ],
};

export type Architecture = 'arm64' | 'amd64';
export function archAffinity(arch: Architecture) {
  return {
    key: 'bes.node.arch',
    operator: 'In',
    values: [arch],
  };
}

export type Purpose = 'workload' | 'ingress' | 'system';
export function purposeAffinity(purpose: Purpose) {
  return {
    key: 'bes.node.purpose',
    operator: 'In',
    values: [purpose],
  };
}
