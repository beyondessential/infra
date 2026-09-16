import type { Input } from '@pulumi/pulumi';

import { cfg } from '../../common/k8s/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';

type Env = { name: string; value: Input<string> }[];

// Where Canopy keeps the bytes of the artifacts it holds. Read from the
// canopy-infra stack, which owns the bucket and grants each role its share of
// it: private-server registers and deregisters, public-server serves, and the
// backups pod sweeps what no artifact reaches. Apply that stack before setting
// this ref, since this reads its outputs.
//
// All three must be given the same bucket. Nothing in Canopy checks they agree,
// and an unset one is a warning at startup rather than a failure, so a deploy
// that forgot it looks healthy until somebody registers an artifact.
//
// The bucket is in the same account as the IRSA roles, so there is no role to
// assume and CANOPY_ARTIFACT_ROLE_ARN stays unset.
const infraRef = cfg.get('canopy-infra');
const infra = infraRef ? new CrossStack(infraRef) : undefined;

export const artifactStoreEnv: Env = infra
  ? [
      { name: 'CANOPY_ARTIFACT_BUCKET', value: infra.get<string>('canopyArtifactBucket') },
      { name: 'CANOPY_ARTIFACT_REGION', value: infra.get<string>('canopyArtifactRegion') },
      { name: 'CANOPY_ARTIFACT_PREFIX', value: infra.get<string>('canopyArtifactPrefix') },
    ]
  : [];
