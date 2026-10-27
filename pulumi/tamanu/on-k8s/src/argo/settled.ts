import { isDeepStrictEqual } from 'node:util';

// The parts of an Argo CD Application that waitForHealthy reads.
export interface LiveApplication {
	spec?: Record<string, unknown>;
	status?: {
		sync?: { status?: string; comparedTo?: Record<string, unknown> };
		health?: { status?: string };
	};
}

/**
 * Whether the Application's sync and health are for its current spec. The controller writes
 * `comparedTo` with the spec it compared, so until it has compared the spec an update applied,
 * the status it shows is still the previous spec's.
 */
export function comparedCurrentSpec(app: LiveApplication): boolean {
	const compared = app.status?.sync?.comparedTo;
	if (!compared) return false;
	return Object.entries(compared).every(([key, value]) =>
		isDeepStrictEqual(value, app.spec?.[key]),
	);
}

/** Whether the Application is Synced and Healthy for its current spec. */
// spec: K8STDR#update-completion
export function settled(app: LiveApplication): boolean {
	return (
		comparedCurrentSpec(app) &&
		app.status?.sync?.status === 'Synced' &&
		app.status?.health?.status === 'Healthy'
	);
}
