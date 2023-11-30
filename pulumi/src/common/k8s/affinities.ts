export const RUN_ON_SPOT = {
  matchExpressions: [
    {
      key: 'bes.node.schedule',
      operator: 'In',
      values: ['spot'],
    },
  ],
};

export function archAffinity(arch: 'arm64' | 'amd64') {
  return {
    key: 'bes.node.arch',
    operator: 'In',
    values: [arch],
  };
}

export function purposeAffinity(purpose: 'workload' | 'ingress' | 'system') {
  return {
    key: 'bes.node.purpose',
    operator: 'In',
    values: [purpose],
  };
}
