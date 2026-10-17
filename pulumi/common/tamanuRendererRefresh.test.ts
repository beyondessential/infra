import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs the real refresh script against a stand-in for kubectl that keeps a small cluster in a
// file: which Applications exist, what renders them, and what has been annotated. An annotated
// Application is rendered again, as Argo CD does, unless the scenario says it never gets to.

const SCRIPT = new URL('../../tamanu/on-k8s/renderer/tools/refresh-channel.sh', import.meta.url)
  .pathname;

const FAKE_KUBECTL = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/calls"
args=" $* "
case "$args" in
  *" rollout restart "* | *" rollout status "*) exit 0 ;;
  *" annotate "*)
    for a in "$@"; do
      case "$a" in applications.argoproj.io/*) echo "\${a#applications.argoproj.io/}" >> "$FAKE_DIR/annotated" ;; esac
    done
    exit 0 ;;
  *" get applications.argoproj.io -o json"*)
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    jq --arg now "$now" --arg annotated "$(cat "$FAKE_DIR/annotated")" --arg stuck "\${FAKE_NO_PROGRESS:-}" '
      ($annotated | split("\\n")) as $names
      | .items |= map(
          ((.metadata.name as $n | $names | index($n)) != null) as $hit
          | if $hit and $stuck == "" then
              del(.metadata.annotations["argocd.argoproj.io/refresh"])
              | .status.reconciledAt = $now
              | walk(if . == "NOW" then $now else . end)
            elif $hit then .metadata.annotations["argocd.argoproj.io/refresh"] = "hard"
            else . end)' "$FAKE_APPS"
    exit 0 ;;
esac
echo "unexpected kubectl call: $*" >&2
exit 99
`;

const STABLE = 'infra-argo-tamanu-renderer-v1';
const CANARY = 'infra-argo-tamanu-renderer-canary-v1';
const OLD = '2020-01-01T00:00:00Z';

function app(name: string, plugin: string, status: object = {}, project = 'tamanu') {
  return {
    metadata: { name },
    spec: { project, source: { plugin: { name: plugin } } },
    status: { reconciledAt: OLD, ...status },
  };
}

function run(channel: string, apps: object[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-channel-'));
  try {
    writeFileSync(join(dir, 'kubectl'), FAKE_KUBECTL);
    chmodSync(join(dir, 'kubectl'), 0o755);
    writeFileSync(join(dir, 'annotated'), '');
    writeFileSync(join(dir, 'calls'), '');
    writeFileSync(join(dir, 'apps.json'), JSON.stringify({ items: apps }));
    const result = spawnSync('bash', [SCRIPT, channel], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        FAKE_DIR: dir,
        FAKE_APPS: join(dir, 'apps.json'),
        WAIT_MINUTES: '0',
        ...env,
      },
    });
    return {
      ...result,
      calls: readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n'),
      annotated: readFileSync(join(dir, 'annotated'), 'utf8').trim().split('\n').filter(Boolean),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cluster = [
  app('canary-1', CANARY),
  app('canary-2', CANARY),
  app('stable-1', STABLE),
  app('stable-2', STABLE),
  app('elsewhere', CANARY, {}, 'not-tamanu'),
];

// spec: K8STRO#promotion
test('a canary promotion refreshes only the Applications rendered by the canary plugin', () => {
  const result = run('canary', cluster);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.annotated.sort(), ['canary-1', 'canary-2']);
});

// spec: K8STRO#promotion
test('a stable promotion refreshes only the Applications rendered by the stable plugin', () => {
  const result = run('stable', cluster);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.annotated.sort(), ['stable-1', 'stable-2']);
});

// spec: K8STRO#promotion
test('the repo server has restarted and rolled out before the first Application is refreshed', () => {
  const { calls } = run('canary', cluster);
  const at = (needle: string) => calls.findIndex((call) => call.includes(needle));
  assert.ok(at('rollout restart') >= 0);
  assert.ok(at('rollout restart') < at('rollout status'));
  assert.ok(at('rollout status') < at('annotate'));
});

const HIBERNATED = {
  resources: [
    { group: 'postgresql.cnpg.io', kind: 'Cluster', health: { status: 'Healthy', message: 'Hibernated' } },
  ],
};
const AWAKE = {
  resources: [
    { group: 'postgresql.cnpg.io', kind: 'Cluster', health: { status: 'Healthy', message: 'Cluster in healthy state' } },
  ],
};

// spec: K8STRO#promotion
test('an Application whose database is hibernated is not refreshed', () => {
  const result = run('canary', [
    app('asleep', CANARY, HIBERNATED),
    app('awake', CANARY, AWAKE),
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.annotated, ['awake']);
});

// spec: K8STRO#promotion
test('a hibernated Application does not fail the promotion', () => {
  const result = run('canary', [app('asleep', CANARY, HIBERNATED)]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.annotated, []);
});

test('a channel with no Applications has nothing to refresh', () => {
  const result = run('canary', [app('stable-1', STABLE)]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.annotated, []);
});

// spec: K8STRO#promotion
test('a render error fails the promotion and names the Application', () => {
  const result = run('canary', [
    app('good', CANARY),
    app('broken', CANARY, { conditions: [{ type: 'ComparisonError', message: 'bad params' }] }),
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed broken: render error: bad params/);
});

// spec: K8STRO#promotion
test('a sync that failed after the refresh fails the promotion', () => {
  const result = run('canary', [
    app('failing', CANARY, { operationState: { phase: 'Failed', message: 'job failed', finishedAt: 'NOW' } }),
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed failing: sync Failed: job failed/);
});

// spec: K8STRO#promotion
test('a sync that failed before the refresh is not this promotion\'s', () => {
  const result = run('canary', [
    app('was-failing', CANARY, { operationState: { phase: 'Failed', finishedAt: OLD } }),
  ]);
  assert.equal(result.status, 0, result.stderr);
});

// spec: K8STRO#promotion
test('Applications that have not rendered again in time fail the promotion', () => {
  const result = run('canary', [app('stuck', CANARY)], { FAKE_NO_PROGRESS: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pending stuck/);
});
