// This program creates a small stub and hands the deployment to Argo CD, which renders it
// with infra-argo-tamanu-renderer. Loaded dynamically: the modules create resources as
// they are evaluated, and must follow the cluster check.
const program = await import('./argo/index.ts');

export const argoApplication = program.argoApplication;
export const urls = program.urls;
