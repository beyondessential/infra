import * as k8s from '@pulumi/kubernetes';
import { name } from './config.ts';

// No HNC here, unlike the old stack this replaces: HNC is disabled on
// data-internal-data (the target cluster this now deploys to), and this
// namespace isn't part of any Tamanu super-namespace tree — see the plan's
// cluster-choice rationale. One flat namespace per stack (dagster-dev,
// dagster-prod), matching agent-slack/pollen/first-officer's own pattern
// rather than the old stack's dagster-<stack>-super/-system split.
const ns = new k8s.core.v1.Namespace(
	name,
	{
		metadata: { name },
	},
	{ ignoreChanges: ['metadata.name'] },
);

export const namespace = ns.metadata.name;
