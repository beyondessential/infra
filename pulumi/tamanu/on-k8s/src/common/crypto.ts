import { createCipheriv } from 'node:crypto';
import { all, type Output, secret } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { RandomBytes } from '@pulumi/random';
import { namespace } from '../namespace.ts';

const CONFIG_KEY_PATH = '/secrets/configKey';
const KEY_FILE_KEY = 'configKey';
const SETTINGS_PSK_KEY = 'settingsPsk';
const SECRET_NAME = 'tamanu-crypto';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH = 12;

/**
 * Encrypts a plaintext string with the given key buffer using AES-256-GCM and
 * returns the `S1:<iv>:<ciphertext+tag>` format that the tamanu shared/crypto
 * module expects. WebCrypto's AES-GCM appends the auth tag to the ciphertext;
 * we mirror that layout so server-side decryptSecret() can read it back.
 */
function encryptSecret(keyBuffer: Buffer, iv: Buffer, plaintext: string): string {
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([ciphertext, authTag]);
  return `S1:${iv.toString('base64')}:${combined.toString('base64')}`;
}

const keyBytes = new RandomBytes('tamanu-crypto-key', { length: KEY_LENGTH_BYTES });
const pskBytes = new RandomBytes('tamanu-crypto-psk', { length: KEY_LENGTH_BYTES });
// Stable IV so the encrypted PSK string is deterministic across `pulumi up`s.
// Reusing iv+key with different plaintexts would be insecure, but we only ever
// encrypt one value (the PSK) under this key, so this is safe.
const ivBytes = new RandomBytes('tamanu-crypto-psk-iv', { length: IV_LENGTH });

const encryptedSettingsPsk: Output<string> = all([
  keyBytes.base64,
  pskBytes.hex,
  ivBytes.base64,
]).apply(([keyB64, pskHex, ivB64]) =>
  secret(
    encryptSecret(Buffer.from(keyB64, 'base64'), Buffer.from(ivB64, 'base64'), pskHex),
  ),
);

const cryptoSecret = new k8s.core.v1.Secret(
  SECRET_NAME,
  {
    metadata: {
      name: SECRET_NAME,
      namespace,
    },
    type: 'Opaque',
    data: {
      [KEY_FILE_KEY]: keyBytes.base64,
    },
    stringData: {
      [SETTINGS_PSK_KEY]: encryptedSettingsPsk,
    },
  },
  { parent: keyBytes },
);

// Reference the Secret via its Output<string> name so Pulumi knows the
// pod spec depends on the Secret being created first; otherwise an initial
// `pulumi up` could try to roll out new pods before the Secret exists,
// leaving them stuck on FailedMount until k8s retries.
export const cryptoVolume: k8s.types.input.core.v1.Volume = {
  name: 'crypto-key',
  secret: {
    secretName: cryptoSecret.metadata.name,
    defaultMode: 0o400,
    items: [{ key: KEY_FILE_KEY, path: KEY_FILE_KEY }],
  },
};

export const cryptoVolumeMount: k8s.types.input.core.v1.VolumeMount = {
  name: 'crypto-key',
  mountPath: '/secrets',
  readOnly: true,
};

export const cryptoEnv: k8s.types.input.core.v1.EnvVar[] = [
  {
    name: 'CRYPTO_KEY_FILE',
    value: CONFIG_KEY_PATH,
  },
  {
    name: 'CRYPTO_SETTINGS_PSK',
    valueFrom: {
      secretKeyRef: {
        name: cryptoSecret.metadata.name,
        key: SETTINGS_PSK_KEY,
      },
    },
  },
];
