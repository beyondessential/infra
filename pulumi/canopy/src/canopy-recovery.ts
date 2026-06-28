import type { Input } from '@pulumi/pulumi';

import { cfg } from '../../common/k8s/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';

type Env = { name: string; value: Input<string> }[];

// recoveryKeys: a JSON array of public age recipients (from `bestool crypto
// keygen`), assembled into the space-separated string the env expects.
const recoveryVaultRef = cfg.get('recoveryVault');
const recoveryKeys = cfg.getObject<string[]>('recoveryKeys');

// The recipients alone. private-server needs these to issue the verification-
// ceremony age challenges (and the backups pod folds them in below).
export const recoveryKeysEnv: Env =
  recoveryKeys && recoveryKeys.length
    ? [{ name: 'CANOPY_RECOVERY_VAULT_KEYS', value: recoveryKeys.join(' ') }]
    : [];

// The backups pod additionally needs the vault location/role. Gated on the
// recoveryVault stack ref; recoveryKeys is mandatory alongside it. The build
// refuses to start without these, so provision the vault + set this config
// before deploying it.
export const recoveryEnv: Env = (() => {
  if (!recoveryVaultRef) return [];
  if (!recoveryKeys || recoveryKeys.length === 0) {
    throw new Error('canopy: recoveryVault is set but recoveryKeys is missing/empty (mandatory)');
  }
  const vault = new CrossStack(recoveryVaultRef);
  return [
    { name: 'CANOPY_RECOVERY_VAULT_BUCKET', value: vault.get<string>('vaultBucket') },
    { name: 'CANOPY_RECOVERY_VAULT_REGION', value: vault.get<string>('vaultRegion') },
    { name: 'CANOPY_RECOVERY_VAULT_ROLE_ARN', value: vault.get<string>('vaultRoleArn') },
    ...recoveryKeysEnv,
  ];
})();
