# Runbook: settings fail to decrypt

A server logs `Decryption failed`, typically `initServerConfig: could not read sync password secret (Decryption failed)` or a trace through `getSettingSecret`, and refuses to start or runs without the secret.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The servers decrypt secret setting values with the key file and settings PSK in the `tamanu-crypto` Secret.
The stack generates the key, the PSK and its IV as Pulumi `RandomBytes` (`tamanu-crypto-key`, `tamanu-crypto-psk`, `tamanu-crypto-psk-iv`, in `tamanu/on-k8s/src/common/crypto.ts`).
A database whose secrets were written under one key cannot be read under another.
A server that refuses to start for another reason is not this: [deployment down but nothing failed](deployment-down-nothing-failed.md), or [a hook Job failed](hook-job-failed.md) when a migrator is the blocker.

## 2. Establish context

Whether the stack was destroyed and updated again, or its databases restored or cloned, and when: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **The stack's updates**: `pulumi stack history` in `pulumi/tamanu/on-k8s`, looking for a `destroy` or an update that created the crypto `RandomBytes`. **[diagnose]**
2. **Whether the key changed**: compare the three values at the last update before that with now, by hash. **[diagnose, sensitive-data]**

   ```sh
   pulumi/scripts/restoreTamanuCryptoKey.fish <stack> <version>
   ```

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| The hashes at `<version>` differ from now, and the databases hold data from before the change | The stack generated a new key, and the data needs the old one. | Section 5. |
| The databases were cloned from another deployment | The secrets were written under that deployment's key, which this stack's history does not hold. | Escalate. |
| The hashes match | The key did not change. | Escalate. |

## 5. Resolve

Put the old values back into the stack's state, then update the stack so it writes them into the Secret. **[dev-OTS, sensitive-data]**

```sh
pulumi/scripts/restoreTamanuCryptoKey.fish <stack> <version> --apply
```

Then update the stack ([change a deployment's config](../sops/change-deployment-config.md)).
The PSK reaches the servers as an environment variable, so restart them unless the update rolls them anyway ([restart services](../sops/restart-services.md)).
The script prints where it saved the state it replaced: delete that file once the servers start.
Confirm with the servers' logs ([read logs](../sops/read-logs.md)): no `Decryption failed` since the restart, and the facilities completing sync sessions. **[diagnose, sensitive-data]**

## 6. Escalate

Escalate a database cloned from another deployment, or matching hashes: the state is **still-diagnosing**, and the next diagnostic is which key wrote the secrets.
Hand over the deployment, its tier and whether its users are blocked, the error line, what happened to the stack and its databases with the `pulumi stack history` versions, and the hash comparison.
The comparison prints hashes only, and the logs may carry patient data: redact before sharing.
