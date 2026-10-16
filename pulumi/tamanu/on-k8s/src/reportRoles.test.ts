import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsLegacyReportRoles } from './reportRoles.ts';

test('releases before 2.60 keep the legacy roles', () => {
  assert.equal(needsLegacyReportRoles('2.59.9'), true);
  assert.equal(needsLegacyReportRoles('2.5.0'), true);
  assert.equal(needsLegacyReportRoles('1.40.2'), true);
});

test('2.60 and later, prereleases included, drop them', () => {
  assert.equal(needsLegacyReportRoles('2.60.0-beta.1'), false);
  assert.equal(needsLegacyReportRoles('2.60.0'), false);
  assert.equal(needsLegacyReportRoles('2.67.1'), false);
  assert.equal(needsLegacyReportRoles('3.0.0'), false);
});
