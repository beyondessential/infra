import type { Input } from '@pulumi/pulumi';

import { cfg } from '../../common/k8s/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';

// Secret recovery vault env for the backups pod. Gated on the recoveryVault
// stack ref: when set, recoveryKeys (a JSON array of public age recipients, from
// `bestool crypto keygen`) is mandatory. The backups build refuses to start
// without these, so provision the vault + set this config before deploying it.
// recoveryKeys is assembled into the space-separated string the env expects.
const recoveryVaultRef = cfg.get('recoveryVault');
const recoveryKeys = cfg.getObject<string[]>('recoveryKeys');

export const recoveryEnv: { name: string; value: Input<string> }[] = (() => {
  if (!recoveryVaultRef) return [];
  if (!recoveryKeys || recoveryKeys.length === 0) {
    throw new Error('canopy: recoveryVault is set but recoveryKeys is missing/empty (mandatory)');
  }
  const vault = new CrossStack(recoveryVaultRef);
  return [
    { name: 'CANOPY_RECOVERY_VAULT_BUCKET', value: vault.get<string>('vaultBucket') },
    { name: 'CANOPY_RECOVERY_VAULT_REGION', value: vault.get<string>('vaultRegion') },
    { name: 'CANOPY_RECOVERY_VAULT_ROLE_ARN', value: vault.get<string>('vaultRoleArn') },
    { name: 'CANOPY_RECOVERY_VAULT_KEYS', value: recoveryKeys.join(' ') },
  ];
})();
