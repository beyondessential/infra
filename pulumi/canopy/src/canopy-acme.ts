import type { Input } from '@pulumi/pulumi';
import type * as k8s from '@pulumi/kubernetes';

import { acmeAccountKey, acmeContact, acmeDirectory } from './config.ts';

/**
 * Canopy's account at the certificate authority.
 *
 * Wanted by two workloads, for different reasons: the domains pod orders
 * certificates with it, and private-server reports the authority, its advertised
 * profiles and whether the account is usable on the settings panel — which it
 * reads from its own environment, so a deployment that gives the account to the
 * domains pod alone issues certificates while telling operators it has no
 * authority configured.
 *
 * Deliberately not in `spec()` alongside `CANOPY_DNS_ZONES`: the zone list is not
 * a secret and has four readers, whereas this is a private key with two, and the
 * pods that make no use of it have no business holding it.
 *
 * Both pods find-or-create the account from the key at startup, so they agree on
 * the contact as well. Empty where no key is configured, which Canopy reports
 * once at startup and treats as a deployment that issues nothing.
 */
export const acmeEnv: Input<k8s.types.input.core.v1.EnvVar>[] = [
  ...(acmeAccountKey ? [{ name: 'CANOPY_ACME_ACCOUNT_KEY', value: acmeAccountKey }] : []),
  ...(acmeDirectory ? [{ name: 'CANOPY_ACME_DIRECTORY', value: acmeDirectory }] : []),
  ...(acmeContact ? [{ name: 'CANOPY_ACME_CONTACT', value: acmeContact }] : []),
];
