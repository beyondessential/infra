import { Config } from '@pulumi/pulumi';

const cfg = new Config();

// The account this stack is meant to run against; guarded in guard.ts.
export const expectedAccountId = cfg.get('expectedAccountId') ?? '658427548944';

// GitHub Actions OIDC `sub` claims allowed to assume the upload role.
export const ghaClaims = cfg.getObject<string[]>('ghaClaims') ?? [
  'repo:beyondessential/linux-images:ref:refs/tags/v*.*.*',
];

export const tags: { [key: string]: string } = {
  Purpose: 'shared-amis',
  ...(cfg.getObject<{ [key: string]: string }>('tags') ?? {}),
};
