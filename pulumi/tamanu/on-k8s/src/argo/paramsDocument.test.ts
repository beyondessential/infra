import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHANNELS } from '../../../../common/tamanuRenderer.ts';
import {
  STUB_ONLY,
  buildParams,
  forChannel,
  selectStackConfig,
  type RenderParams,
} from './paramsDocument.ts';

const sample: RenderParams = {
  stack: 'main',
  imageTag: 'sha-a25d1d40354fd2d38442bce75328310ca37abae9',
  appVersion: '2.67.0',
  config: { nodeEnv: 'staging', facilities: '2', patientPortalReplicas: '1' },
  cluster: {
    fullName: 'tamanu-internal-main',
    dnsZoneDomains: ['tamanu.app'],
    tailscaleProxyDefaultTags: ['tag:k8s-proxy'],
    networkV4Cidr: '10.20.0.0/16',
    networkV6Cidr: '2406:da1c:1234:5600::/56',
    backupsBucket: 'example-backups',
    backupsServiceAccountArn: 'arn:aws:iam::123456789012:role/example-backups',
  },
  billing: { stage: 'staging', deployment: 'main' },
};

const fixtures = new URL(
  '../../../../../tamanu/on-k8s/renderer/tests/fixtures/stub/',
  import.meta.url,
);

function document(channel: (typeof CHANNELS)[number]): string {
  return `${JSON.stringify(forChannel(channel, buildParams(sample)), null, 2)}\n`;
}

// The renderer's own tests and CI read these files, so the shape each channel's renderer has to
// accept is reviewed as a diff of them. Regenerate with UPDATE_FIXTURES=1.
// spec: TRO#parameters
for (const channel of CHANNELS) {
  test(`the ${channel} fixture is what the stub sends to ${channel}`, () => {
    const file = new URL(`${channel}.json`, fixtures);
    if (process.env.UPDATE_FIXTURES || !existsSync(file)) {
      writeFileSync(file, document(channel));
    }
    assert.equal(readFileSync(file, 'utf8'), document(channel));
  });
}

// spec: TRO#parameters
test('canary receives the newest shape, and stable the one its renderer accepts', () => {
  const params = buildParams(sample);
  assert.deepEqual(forChannel('canary', params), params);
  assert.deepEqual(forChannel('stable', params), params);
});

// spec: TRO#parameters
test('the channel setting is not passed to the renderer', () => {
  const config = selectStackConfig(
    {
      'tamanu-on-k8s:rendererChannel': 'canary',
      'tamanu-on-k8s:imageTag': 'sha-abc',
      'tamanu-on-k8s:facilities': '3',
      'other-project:facilities': '9',
    },
    'tamanu-on-k8s',
    new Set(),
  );
  assert.deepEqual(config, { facilities: '3' });
  assert.ok(STUB_ONLY.has('rendererChannel'));
});

test('a secret in the stack config is refused', () => {
  assert.throws(
    () =>
      selectStackConfig(
        { 'tamanu-on-k8s:token': 'x' },
        'tamanu-on-k8s',
        new Set(['tamanu-on-k8s:token']),
      ),
    /token is a secret/,
  );
});
