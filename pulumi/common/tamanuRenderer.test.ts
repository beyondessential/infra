import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHANNELS,
  parseChannel,
  pluginBaseName,
  pluginName,
  rendererImage,
  UNKNOWN_CONFIG_KEYS_ENV,
  unknownConfigKeys,
} from './tamanuRenderer.ts';

// r[verify channel.default]
test('a deployment that names no channel is rendered by stable', () => {
  assert.equal(parseChannel(undefined), 'stable');
  assert.equal(parseChannel(null), 'stable');
  assert.equal(parseChannel(''), 'stable');
});

// r[verify channel.default]
test('the string "null", which is how CD writes an unset option, means stable', () => {
  assert.equal(parseChannel('null'), 'stable');
});

test('each channel is accepted by name', () => {
  assert.equal(parseChannel('stable'), 'stable');
  assert.equal(parseChannel('canary'), 'canary');
});

// r[verify channel.unknown]
test('any other channel is refused with the accepted ones listed', () => {
  for (const wrong of ['canry', 'Canary', 'main', 'sha-abc1234']) {
    assert.throws(() => parseChannel(wrong), /use stable or canary/);
  }
});

// r[verify channel.stable-continuity]
test('stable registers under the name existing Applications refer to', () => {
  assert.equal(pluginBaseName('stable'), 'infra-argo-tamanu-renderer');
  assert.equal(pluginName('stable'), 'infra-argo-tamanu-renderer-v1');
});

// r[verify plugin.per-channel]
test('every channel has a plugin name of its own', () => {
  const names = CHANNELS.map(pluginName);
  assert.equal(new Set(names).size, CHANNELS.length);
  assert.equal(pluginName('canary'), 'infra-argo-tamanu-renderer-canary-v1');
});

// r[verify channel.tags]
test('a sidecar runs the image at its channel tag', () => {
  assert.equal(rendererImage('stable'), 'ghcr.io/beyondessential/infra-argo-tamanu-renderer:stable');
  assert.equal(rendererImage('canary'), 'ghcr.io/beyondessential/infra-argo-tamanu-renderer:canary');
});

// The promotion script picks Applications by plugin name without importing this module, so a
// rename here has to be made there too.
test('the promotion script names the same plugins', () => {
  const script = readFileSync(
    new URL('../../tamanu/on-k8s/renderer/tools/refresh-channel.sh', import.meta.url),
    'utf8',
  );
  for (const channel of CHANNELS) {
    assert.ok(
      script.includes(`${channel}) plugin=${pluginName(channel)} ;;`),
      `refresh-channel.sh does not name ${pluginName(channel)} for ${channel}`,
    );
  }
});

// r[verify params.unknown-config-keys]
test('stable ignores a stack config key it does not know and canary rejects it', () => {
  assert.equal(unknownConfigKeys('stable'), 'ignore');
  assert.equal(unknownConfigKeys('canary'), 'reject');
});

// The renderer reads the setting from the environment, so the name here has to be its own.
test('the renderer reads the variable the sidecars set', () => {
  const main = readFileSync(
    new URL('../../tamanu/on-k8s/renderer/src/main.rs', import.meta.url),
    'utf8',
  );
  assert.ok(main.includes(`env = "${UNKNOWN_CONFIG_KEYS_ENV}"`));
});
