import { test } from 'node:test';
import { deepEqual, equal, match } from 'node:assert/strict';
import { deployerBindingsIncludePeople } from './deployerBindings';

const resource = (type: string, props: any, name = 'r'): any => ({
  type,
  props,
  name,
  urn: `urn:pulumi:main::proj::${type}::${name}`,
  opts: {},
  dependencies: [],
  propertyDependencies: {},
  asType: (cls: any) => (cls.__pulumiType === type ? props : undefined),
});

const groups = (...names: string[]) => names.map((name) => ({ kind: 'Group', name }));

const ALL = groups(
  'tailscale:tamanu-deploy',
  'tailscale:engineer',
  'tailscale:tamanu-engineer',
  'tailscale:oncall',
);

const roleBinding = (subjects: any[]) =>
  resource('kubernetes:rbac.authorization.k8s.io/v1:RoleBinding', { subjects }, 'rb');

const clusterRoleBinding = (subjects: any[]) =>
  resource('kubernetes:rbac.authorization.k8s.io/v1:ClusterRoleBinding', { subjects }, 'crb');

const violationsFor = (resources: any[]): string[] => {
  const violations: string[] = [];
  (deployerBindingsIncludePeople.validateStack as any)({ resources }, (message: string) =>
    violations.push(message),
  );
  return violations;
};

// spec: K8SNSP#human-deployers
test('a binding that names the deployer and every human group is accepted', () => {
  deepEqual(violationsFor([roleBinding(ALL), clusterRoleBinding(ALL)]), []);
});

// spec: K8SNSP#human-deployers
test('a binding of the deployer alone is rejected, naming each missing group', () => {
  const violations = violationsFor([roleBinding(groups('tailscale:tamanu-deploy'))]);
  equal(violations.length, 1);
  match(violations[0], /tailscale:engineer, tailscale:tamanu-engineer, tailscale:oncall/);
});

// spec: K8SNSP#human-deployers
test('a cluster binding that leaves out on-call is rejected', () => {
  const violations = violationsFor([
    clusterRoleBinding(
      groups('tailscale:tamanu-deploy', 'tailscale:engineer', 'tailscale:tamanu-engineer'),
    ),
  ]);
  equal(violations.length, 1);
  match(violations[0], /\[tailscale:oncall\]/);
});

// spec: K8SNSP#human-deployers
test('bindings that do not name the deployer are ignored', () => {
  deepEqual(
    violationsFor([
      roleBinding(groups('tailscale:engineer')),
      clusterRoleBinding(groups('tailscale:gha:canopy')),
      roleBinding([{ kind: 'ServiceAccount', name: 'tailscale:tamanu-deploy' }]),
      roleBinding([]),
      resource('kubernetes:core/v1:Namespace', { metadata: { name: 'x' } }),
    ]),
    [],
  );
});
