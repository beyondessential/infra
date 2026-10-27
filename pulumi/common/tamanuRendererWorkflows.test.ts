import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// The promotion is a pair of workflows, which a code citation cannot cover, so what the spec asks of them
// is checked here from their structure.

function workflow(name: string) {
  const file = new URL(`../../.github/workflows/${name}`, import.meta.url);
  return parse(readFileSync(file, 'utf8')) as {
    on: Record<string, { inputs?: Record<string, { default?: unknown; options?: string[] }> }>;
    concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
    jobs: Record<string, any>;
  };
}

const promote = workflow('infra-argo-tamanu-renderer-promote.yml');
const cd = workflow('infra-argo-tamanu-renderer-cd.yml');
const CLUSTERS = ['tamanu-internal-main', 'shared-demos-demo'];

// spec: K8STRO#promotion
test('promotions run one at a time and are never cancelled by the next', () => {
  assert.ok(promote.concurrency?.group);
  assert.equal(promote.concurrency['cancel-in-progress'], false);
});

// spec: K8STRO#promotion
test('every build from main is promoted to canary once it has been built', () => {
  const job = cd.jobs['promote-canary'];
  assert.deepEqual(job.needs, ['build-image']);
  assert.equal(job.if, "github.event_name == 'push'");
  assert.match(job.uses, /infra-argo-tamanu-renderer-promote\.yml$/);
  assert.equal(job.with.channel, 'canary');
  assert.equal(job.with.sha, '${{ github.sha }}');
});

// spec: K8STRO#promotion
test('stable moves only when someone runs the workflow and names the commit', () => {
  assert.ok(promote.on.workflow_dispatch);
  const inputs = promote.on.workflow_dispatch.inputs ?? {};
  assert.deepEqual(inputs.channel?.options, ['stable', 'canary']);
  assert.ok(inputs.sha);
  assert.equal(JSON.stringify(cd.on).includes('stable'), false);
});

// spec: K8STRO#promotion
test('a promotion applies to every cluster that runs Tamanu deployments by default', () => {
  for (const trigger of [promote.on.workflow_dispatch, promote.on.workflow_call]) {
    assert.deepEqual(String(trigger.inputs?.clusters?.default).split(' ').sort(), [...CLUSTERS].sort());
  }
  const refresh = promote.jobs.refresh;
  assert.equal(refresh.environment, '${{ matrix.cluster }}');
  assert.match(refresh.strategy.matrix.cluster, /plan\.outputs\.clusters/);
});

// spec: K8STRO#promotion
test('a cluster that fails does not stop the others, and the failures are reported', () => {
  assert.equal(promote.jobs.refresh.strategy['fail-fast'], false);
  assert.deepEqual(promote.jobs.report.needs, ['plan', 'refresh']);
  assert.equal(promote.on.workflow_dispatch.inputs?.retag?.default, true);
});

// spec: K8STRO#promotion
test('the tag is moved by the script that refuses a build that does not exist', () => {
  const steps: { run?: string }[] = promote.jobs.retag.steps;
  assert.ok(steps.some((step) => step.run?.includes('tools/retag-channel.sh')));
  const script = readFileSync(
    new URL('../../tamanu/on-k8s/renderer/tools/retag-channel.sh', import.meta.url),
    'utf8',
  );
  assert.ok(script.indexOf('imagetools inspect') < script.indexOf('imagetools create'));
});

// spec: K8STRO#promotion
test('the repo server is restarted and has rolled out before anything is refreshed', () => {
  const script = readFileSync(
    new URL('../../tamanu/on-k8s/renderer/tools/refresh-channel.sh', import.meta.url),
    'utf8',
  );
  const restart = script.indexOf('rollout restart');
  const status = script.indexOf('rollout status');
  const refresh = script.indexOf('argocd.argoproj.io/refresh=hard');
  assert.ok(restart > 0 && restart < status && status < refresh);
});
