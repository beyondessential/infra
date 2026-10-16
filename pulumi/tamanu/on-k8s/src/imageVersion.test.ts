import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageVersion } from './imageVersion.ts';

const reply = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => body,
  }) as Response;

function registry(routes: Record<string, unknown>) {
  const seen: string[] = [];
  const fetchFn = (async (url: string) => {
    seen.push(url);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    return key ? reply(routes[key]) : reply({}, false);
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

const LABELS = { config: { Labels: { 'org.opencontainers.image.version': '2.67.1' } } };

test('reads the label through a multi-platform index, skipping attestations', async () => {
  const { fetchFn, seen } = registry({
    '/token?scope=repository:o/central:pull': { token: 't' },
    '/manifests/sha-abc': {
      manifests: [
        { digest: 'sha256:att', platform: { os: 'unknown', architecture: 'unknown' } },
        { digest: 'sha256:amd', platform: { os: 'linux', architecture: 'amd64' } },
      ],
    },
    '/manifests/sha256:amd': { config: { digest: 'sha256:cfg' } },
    '/blobs/sha256:cfg': LABELS,
  });
  assert.equal(await imageVersion('o/central', 'sha-abc', fetchFn), '2.67.1');
  assert.ok(!seen.some((u) => u.includes('sha256:att')));
});

test('reads the label from a single-platform manifest', async () => {
  const { fetchFn } = registry({
    '/token?scope=repository:o/central:pull': { token: 't' },
    '/manifests/v1': { config: { digest: 'sha256:cfg' } },
    '/blobs/sha256:cfg': LABELS,
  });
  assert.equal(await imageVersion('o/central', 'v1', fetchFn), '2.67.1');
});

test('an image without the label has no version', async () => {
  const { fetchFn } = registry({
    '/token?scope=repository:o/central:pull': { token: 't' },
    '/manifests/v1': { config: { digest: 'sha256:cfg' } },
    '/blobs/sha256:cfg': { config: { Labels: {} } },
  });
  assert.equal(await imageVersion('o/central', 'v1', fetchFn), undefined);
});

test('an unknown tag is an error, not a missing version', async () => {
  const { fetchFn } = registry({ '/token?scope=repository:o/central:pull': { token: 't' } });
  await assert.rejects(imageVersion('o/central', 'nope', fetchFn), /404/);
});
