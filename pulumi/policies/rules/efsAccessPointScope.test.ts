import { test } from 'node:test';
import { deepEqual, equal, match } from 'node:assert/strict';
import { efsAccessPointScoped } from './efsAccessPointScope';

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

const SOUND_PARAMETERS = {
  provisioningMode: 'efs-ap',
  fileSystemId: 'fs-0abc',
  subPathPattern: '/${.PVC.namespace}/${.PVC.name}',
  ensureUniqueDirectory: 'true',
};

const storageClass = (parameters: any, provisioner = 'efs.csi.aws.com') =>
  resource('kubernetes:storage.k8s.io/v1:StorageClass', { provisioner, parameters }, 'sc');

const volume = (volumeHandle?: string, driver = 'efs.csi.aws.com') =>
  resource(
    'kubernetes:core/v1:PersistentVolume',
    { spec: { csi: { driver, volumeHandle } } },
    'pv',
  );

const violationsFor = (resources: any[]): string[] => {
  const violations: string[] = [];
  (efsAccessPointScoped.validateStack as any)({ resources }, (message: string) =>
    violations.push(message),
  );
  return violations;
};

// k[verify volumes.shared-isolation+2]
test('the shipped storage class satisfies the rule', () => {
  deepEqual(violationsFor([storageClass(SOUND_PARAMETERS)]), []);
});

// k[verify volumes.shared-isolation+2]
test('a storage class with no subPathPattern is rejected', () => {
  const violations = violationsFor([
    storageClass({ ...SOUND_PARAMETERS, subPathPattern: undefined }),
  ]);
  equal(violations.length, 1);
  match(violations[0], /filesystem root/);
});

// k[verify volumes.shared-isolation+2]
test('a subPathPattern at the root is rejected', () => {
  const violations = violationsFor([storageClass({ ...SOUND_PARAMETERS, subPathPattern: '/' })]);
  equal(violations.length, 2);
  match(violations.join('\n'), /shallower than two segments/);
});

// k[verify volumes.shared-isolation+2]
test('a subPathPattern shared by every claim is rejected', () => {
  const violations = violationsFor([
    storageClass({ ...SOUND_PARAMETERS, subPathPattern: '/shared/blobs' }),
  ]);
  equal(violations.length, 1);
  match(violations[0], /does not vary by \.PVC\.name/);
});

// k[verify volumes.shared-reclaim]
test('a storage class that lets a rebuilt claim adopt a directory is rejected', () => {
  const violations = violationsFor([
    storageClass({ ...SOUND_PARAMETERS, ensureUniqueDirectory: 'false' }),
  ]);
  equal(violations.length, 1);
  match(violations[0], /ensureUniqueDirectory/);
});

// k[verify volumes.shared-isolation+2]
test('directory provisioning is rejected in favour of access points', () => {
  const violations = violationsFor([
    storageClass({ ...SOUND_PARAMETERS, provisioningMode: 'efs-directory' }),
  ]);
  equal(violations.length, 1);
  match(violations[0], /efs-directory/);
});

// k[verify volumes.shared-isolation+2]
test('a persistent volume naming an access point is accepted', () => {
  deepEqual(violationsFor([volume('fs-0abc::fsap-0def')]), []);
});

// k[verify volumes.shared-isolation+2]
test('a persistent volume naming the whole filesystem is rejected', () => {
  const violations = violationsFor([volume('fs-0abc')]);
  equal(violations.length, 1);
  match(violations[0], /names no access point/);
});

// k[verify volumes.shared-isolation+2]
test('a persistent volume with no handle is rejected', () => {
  const violations = violationsFor([volume()]);
  equal(violations.length, 1);
  match(violations[0], /\(unset\)/);
});

test('volumes and classes from other drivers are ignored', () => {
  deepEqual(
    violationsFor([
      storageClass({}, 'ebs.csi.aws.com'),
      volume('vol-0abc', 'ebs.csi.aws.com'),
    ]),
    [],
  );
});
