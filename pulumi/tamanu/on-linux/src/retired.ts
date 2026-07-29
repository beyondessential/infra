import { RedirectSite } from '../../../common/RedirectSite.ts';
import { billingTags, redirects, zoneId } from './config.ts';

/**
 * Everything a retired deployment still has: its hostnames, answering with
 * permanent redirects to whatever replaced them.
 *
 * Also used by deployments that are still running but have moved, which keep
 * their old hostnames alive through `extraRedirects`.
 */
export const redirectSite = new RedirectSite('redirects', {
  redirects,
  zoneId,
  tags: {
    Purpose: 'tamanu-redirect',
    ManagedBy: 'pulumi',
    ...billingTags,
  },
});
