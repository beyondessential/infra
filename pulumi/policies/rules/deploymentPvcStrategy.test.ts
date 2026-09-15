import { test } from 'node:test';
import { deepEqual, equal, match } from 'node:assert/strict';
import { deploymentPvcNeedsRecreate } from './deploymentPvcStrategy';

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

const claim = (name: string, accessModes: string[]) =>
  resource(
    'kubernetes:core/v1:PersistentVolumeClaim',
    { metadata: { name }, spec: { accessModes } },
    name,
  );

const deployment = (claimNames: string[], strategyType?: string) =>
  resource('kubernetes:apps/v1:Deployment', {
    spec: {
      strategy: strategyType ? { type: strategyType } : undefined,
      template: {
        spec: {
          volumes: claimNames.map((claimName) => ({
            name: claimName,
            persistentVolumeClaim: { claimName },
          })),
        },
      },
    },
  });

const violationsFor = (resources: any[]): string[] => {
  const violations: string[] = [];
  (deploymentPvcNeedsRecreate.validateStack as any)({ resources }, (message: string) =>
    violations.push(message),
  );
  return violations;
};

test('a rolling deployment on a ReadWriteOnce claim is rejected', () => {
  const violations = violationsFor([
    claim('data', ['ReadWriteOnce']),
    deployment(['data'], 'RollingUpdate'),
  ]);
  equal(violations.length, 1);
  match(violations[0], /\[data\]/);
  match(violations[0], /'RollingUpdate'/);
});

test('an unset strategy is reported as the rolling default', () => {
  const violations = violationsFor([claim('data', ['ReadWriteOnce']), deployment(['data'])]);
  equal(violations.length, 1);
  match(violations[0], /RollingUpdate \(default\)/);
});

test('Recreate satisfies the rule', () => {
  deepEqual(
    violationsFor([claim('data', ['ReadWriteOnce']), deployment(['data'], 'Recreate')]),
    [],
  );
});

test('a ReadWriteMany claim may be rolled through', () => {
  deepEqual(
    violationsFor([claim('blobs', ['ReadWriteMany']), deployment(['blobs'], 'RollingUpdate')]),
    [],
  );
});

test('a claim declared outside the stack is treated as ReadWriteOnce', () => {
  const violations = violationsFor([deployment(['elsewhere'], 'RollingUpdate')]);
  equal(violations.length, 1);
  match(violations[0], /\[elsewhere\]/);
});

test('only the ReadWriteOnce claims are named when a deployment mounts both', () => {
  const violations = violationsFor([
    claim('blobs', ['ReadWriteMany']),
    claim('data', ['ReadWriteOnce']),
    deployment(['blobs', 'data'], 'RollingUpdate'),
  ]);
  equal(violations.length, 1);
  match(violations[0], /\[data\]/);
});

test('a deployment mounting no claim is ignored', () => {
  deepEqual(violationsFor([deployment([], 'RollingUpdate')]), []);
});

// Mirrors the wrapper @pulumi/policy puts around resource inputs: every object a
// property access returns is itself wrapped, which is what array methods trip on.
const proxied = (value: any): any =>
  value instanceof Object ? new Proxy(value, { get: (o, p) => proxied((o as any)[p]) }) : value;

const throughProxy = (r: any): any => ({ ...r, asType: (cls: any) => proxied(r.asType(cls)) });

test('claims are read through the proxy policy inputs arrive wrapped in', () => {
  const violations = violationsFor([
    throughProxy(claim('data', ['ReadWriteOnce'])),
    throughProxy(deployment(['data'], 'RollingUpdate')),
  ]);
  equal(violations.length, 1);
  match(violations[0], /\[data\]/);
});
