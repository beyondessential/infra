import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { serviceAccountName } from './serviceAccount.ts';
import { userDeploymentsValues } from './codeLocations.ts';
import { registrySecretName, registrySecret } from './secrets.ts';
import {
	awsRegion,
	dagsterChartVersion,
	dbDatabase,
	dbHost,
	dbIamAuth,
	dbPassword,
	dbPort,
	dbUser,
	computeLogsBucket,
	cpuRequest,
	memoryRequest,
	runPodCpuRequest,
	runPodMemoryRequest,
} from './config.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';

// Preferred-spot affinity shared by the webserver, daemon and user-deployment
// pods (not run pods — see runLauncher below). Matches agent-slack's own
// shape exactly.
const SPOT_PREFERRED_AFFINITY = {
	nodeAffinity: {
		preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 1, preference: RUN_ON_SPOT }],
		requiredDuringSchedulingIgnoredDuringExecution: {
			nodeSelectorTerms: [
				{ matchExpressions: [purposeAffinity('workload'), archAffinity('amd64')] },
			],
		},
	},
};
const SPOT_TOLERATIONS = [CAN_RUN_ON_SPOT];

const imagePullSecrets = registrySecret ? [{ name: registrySecretName }] : [];

// dbIamAuth: RDS IAM auth via the chart's native aws_wif support instead of a
// stored password — see config.ts's own comment and dagster-infra's for the
// two RDS/Postgres-side prerequisites neither project can confirm or do
// itself. `dbPassword!`: config.ts already throws at module load if
// `!dbIamAuth && !dbPassword`, so it's guaranteed defined by the time this
// runs — the assertion is just TypeScript not seeing across that boundary.
const postgresqlAuth = dbIamAuth
	? { authProvider: { type: 'aws_wif', awsRegion }, generatePostgresqlPasswordSecret: false }
	: { postgresqlPassword: dbPassword! };

// This values object is inferred from the chart's own documented schema
// (helm/dagster/values.yaml at the pinned version) by reading it directly —
// NOT yet verified end to end with a real `pulumi preview` against a live
// cluster, which needs stack config and cloud access this draft doesn't
// have. Félix (or whoever applies this first) should run that preview
// before relying on it; a values.schema.json mismatch would only surface
// there, not from `tsc`.
new k8s.helm.v3.Release('dagster', {
	chart: 'dagster',
	version: dagsterChartVersion,
	repositoryOpts: {
		repo: 'https://dagster-io.github.io/helm',
	},
	namespace,
	values: {
		global: {
			serviceAccountName,
		},
		imagePullSecrets,
		dagsterWebserver: {
			resources: { requests: { cpu: cpuRequest, memory: memoryRequest } },
			affinity: SPOT_PREFERRED_AFFINITY,
			tolerations: SPOT_TOLERATIONS,
		},
		dagsterDaemon: {
			resources: { requests: { cpu: cpuRequest, memory: memoryRequest } },
			affinity: SPOT_PREFERRED_AFFINITY,
			tolerations: SPOT_TOLERATIONS,
			// Matches devops/k8s/dagster.yaml (data-lake) exactly — same limits as
			// EC2 production. If max_retries changes there, change it here too; see
			// that file's own comment on dagster/_sensors/_helpers.py::is_final_retry.
			runCoordinator: {
				enabled: true,
				type: 'QueuedRunCoordinator',
				config: {
					queuedRunCoordinator: {
						maxConcurrentRuns: 2,
						tagConcurrencyLimits: [
							{ key: 'dagster/backfill', limit: 1 },
							{ key: 'processing_load', value: 'heavy', limit: 1 },
							{
								key: 'database',
								value: { applyLimitPerUniqueValue: true },
								limit: 1,
							},
						],
					},
				},
			},
			runMonitoring: { enabled: true },
			runRetries: { enabled: true, maxRetries: 1 },
		},
		// Also matches devops/k8s/dagster.yaml exactly.
		retention: {
			enabled: true,
			schedule: { purgeAfterDays: 14 },
			sensor: { purgeAfterDays: { skipped: 1, failure: 1, success: 7 } },
			autoMaterialize: { purgeAfterDays: 7 },
		},
		postgresql: {
			enabled: false,
			postgresqlHost: dbHost,
			postgresqlUsername: dbUser,
			postgresqlDatabase: dbDatabase,
			service: { port: dbPort },
			...postgresqlAuth,
		},
		computeLogManager: {
			type: 'S3ComputeLogManager',
			config: {
				s3ComputeLogManager: {
					bucket: computeLogsBucket,
					// Matches the object prefix the dagster-infra project's S3 policy
					// scopes access to exactly — keep the two in sync by hand.
					prefix: 'dagster-compute-logs',
				},
			},
		},
		runLauncher: {
			type: 'K8sRunLauncher',
			config: {
				k8sRunLauncher: {
					// Deliberately NOT the spot-preferred affinity above: a spot
					// reclaim mid-run burns the single retry (runRetries.maxRetries:
					// 1 above), unlike the long-lived webserver/daemon/code-server
					// pods, which just reschedule. On-demand only, for now — see the
					// plan's Phase 2 step 4 ("run pods go on on-demand at first").
					nodeSelector: {
						'bes.node.purpose': 'workload',
						'bes.node.schedule': 'ondemand',
					},
					resources: { requests: { cpu: runPodCpuRequest, memory: runPodMemoryRequest } },
				},
			},
		},
		'dagster-user-deployments': {
			enabled: true,
			enableSubchart: true,
			imagePullSecrets,
			deployments: userDeploymentsValues,
		},
	},
});
