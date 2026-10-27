import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type LiveApplication, comparedCurrentSpec, settled } from './settled.ts';

const source = {
	repoURL: 'https://github.com/beyondessential/infra',
	path: '.',
	targetRevision: '14ad80a52dfac3bfb5fb8367eea004029a2a26b0',
	plugin: { name: 'infra-argo-tamanu-renderer-v1', env: [{ name: 'PARAMS', value: '{"a":1}' }] },
};
const destination = { server: 'https://kubernetes.default.svc', namespace: 'tamanu-main' };

function app(compared: Record<string, unknown> | undefined, sync = 'Synced', health = 'Healthy') {
	return {
		spec: { project: 'tamanu', source, destination, syncPolicy: { automated: {} } },
		status: { sync: { status: sync, comparedTo: compared }, health: { status: health } },
	} satisfies LiveApplication;
}

test('a status compared against the current spec is settled when Synced and Healthy', () => {
	assert.ok(settled(app({ source, destination })));
});

test('a status compared against a previous spec is not settled', () => {
	const previous = {
		...source,
		plugin: { ...source.plugin, env: [{ name: 'PARAMS', value: '{"a":0}' }] },
	};
	assert.ok(!comparedCurrentSpec(app({ source: previous, destination })));
	assert.ok(!settled(app({ source: previous, destination })));
});

test('a status that was never compared is not settled', () => {
	assert.ok(!settled(app(undefined)));
});

test('key order does not matter', () => {
	const reordered = {
		plugin: source.plugin,
		targetRevision: source.targetRevision,
		path: '.',
		repoURL: source.repoURL,
	};
	assert.ok(comparedCurrentSpec(app({ destination, source: reordered })));
});

test('a current comparison that is not Synced and Healthy is not settled', () => {
	assert.ok(!settled(app({ source, destination }, 'OutOfSync')));
	assert.ok(!settled(app({ source, destination }, 'Synced', 'Progressing')));
});
