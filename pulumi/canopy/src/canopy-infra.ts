import { cfg } from '../../common/k8s/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';

// The canopy-infra stack owns the IRSA roles and the artifact bucket. The
// reference to it lives here so the whole program shares one: a StackReference
// is a resource named after the stack it reads, so constructing it in two
// modules collides on URN.
//
// Undefined when the ref is unset (e.g. dev), and every consumer is gated on
// that.
const infraRef = cfg.get('canopy-infra');

export const canopyInfra = infraRef ? new CrossStack(infraRef) : undefined;
