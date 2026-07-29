import { test } from 'node:test';
import { deepEqual, equal, match } from 'node:assert/strict';
import { GUARDDUTY_OWNER_PROJECT, guarddutySingleOwner, projectFromUrn } from './guardduty';

const urn = (project: string, type: string, name = 'r') =>
  `urn:pulumi:main::${project}::${type}::${name}`;

const violationsFor = (project: string, type: string): string[] => {
  const violations: string[] = [];
  // The policy is synchronous; args beyond type/urn are unused by this rule.
  (guarddutySingleOwner.validateResource as any)(
    { type, urn: urn(project, type), name: 'r', props: {}, opts: {} },
    (message: string) => violations.push(message),
  );
  return violations;
};

test('project is read out of the urn', () => {
  equal(
    projectFromUrn(urn('security-monitoring', 'aws:guardduty/detector:Detector')),
    'security-monitoring',
  );
  equal(projectFromUrn('not-a-urn'), undefined);
});

test('GuardDuty resources are allowed in the owning project', () => {
  for (const type of [
    'aws:guardduty/detector:Detector',
    'aws:guardduty/organizationAdminAccount:OrganizationAdminAccount',
    'aws:guardduty/organizationConfiguration:OrganizationConfiguration',
    'aws:guardduty/member:Member',
  ]) {
    deepEqual(violationsFor(GUARDDUTY_OWNER_PROJECT, type), [], type);
  }
});

test('GuardDuty resources are rejected anywhere else', () => {
  const violations = violationsFor('backup-monitoring', 'aws:guardduty/detector:Detector');
  equal(violations.length, 1);
  match(violations[0], /declared in project 'backup-monitoring'/);
  match(violations[0], new RegExp(`belong only to '${GUARDDUTY_OWNER_PROJECT}'`));
});

test('non-GuardDuty resources are ignored regardless of project', () => {
  for (const type of [
    'aws:sns/topic:Topic',
    'aws:iam/role:Role',
    'kubernetes:apps/v1:Deployment',
  ]) {
    deepEqual(violationsFor('anything', type), [], type);
  }
});

test('a resource whose type merely mentions guardduty is not matched', () => {
  // Guards against a looser check such as type.includes('guardduty').
  deepEqual(violationsFor('other', 'aws:cloudwatch/eventRule:EventRule'), []);
  deepEqual(violationsFor('other', 'aws:iam/role:Role'), []);
});
