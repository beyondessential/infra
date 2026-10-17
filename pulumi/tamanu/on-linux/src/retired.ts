// spec: LNXSRV#retired-deployments
import { RedirectSite } from '../../../common/RedirectSite.ts';
import { billingTags, redirects, zoneId } from './config.ts';

/**
 * Everything a retired deployment still has: its hostnames, answering with
 * permanent redirects to whatever replaced them.
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
