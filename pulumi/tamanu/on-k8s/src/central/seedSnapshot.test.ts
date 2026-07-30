import { test } from 'node:test';
import assert from 'node:assert/strict';
import semver from 'semver';
import { type Candidate, pickCandidate } from './seedSnapshot.ts';

const candidate = (version: string): Candidate => ({
  name: `pgsnap-${version}`,
  version,
  boundContent: `content-${version}`,
});

// Newest-first, as findSnapshotSource sorts them.
const CANDIDATES = ['2.61.0', '2.59.0', '2.54.0'].map(candidate);

const pick = (appVersion: string | null, previousMinor: boolean, candidates = CANDIDATES) => {
  const target = appVersion ? semver.parse(appVersion) : null;
  return pickCandidate({ candidates, target, previousMinor })?.version;
};

test('a release deploy takes the newest snapshot from before its own minor', () => {
  assert.equal(pick('2.62.0', true), '2.61.0');
  assert.equal(pick('2.61.0', true), '2.59.0');
  assert.equal(pick('2.60.0', true), '2.59.0');
});

test('a release deploy ignores a snapshot for its own version', () => {
  // 2.61.0 exists, but restoring it would mean the release's migrations never run.
  assert.notEqual(pick('2.61.0', true), '2.61.0');
});

test('a release deploy with nothing older selects nothing', () => {
  assert.equal(pick('2.54.0', true), undefined);
  assert.equal(pick('2.40.0', true), undefined);
});

test('a release deploy without a resolvable version falls back to matching behaviour', () => {
  assert.equal(pick(null, true), '2.61.0');
});

test('an ordinary deploy prefers its own minor, else the newest', () => {
  assert.equal(pick('2.59.3', false), '2.59.0');
  assert.equal(pick('2.62.0', false), '2.61.0');
  assert.equal(pick(null, false), '2.61.0');
});

test('patch versions do not count as older than their own minor', () => {
  assert.equal(pick('2.61.4', true), '2.59.0');
});

test('a major bump takes the newest of the previous major', () => {
  assert.equal(pick('3.0.0', true), '2.61.0');
});
