// Canopy control-plane ServiceAccount identities. Shared so the central-account
// IRSA roles (canopy-infra) and the in-cluster ServiceAccounts (canopy) agree on
// names, and the IRSA trust subjects line up.
export const CANOPY_SA_ISSUER = 'canopy-issuer';
export const CANOPY_SA_JOBS = 'canopy-jobs';
export const CANOPY_SA_PRIVATE = 'canopy-private';

// Canopy's k8s namespace. Pinned to `tamanu-meta-<stack>` to match
// `canopy/src/config.ts` normalizedStack (the live namespace was kept when the
// project was renamed from tamanu-meta to canopy).
export const canopyNamespace = (stack: string): string => `tamanu-meta-${stack}`;
