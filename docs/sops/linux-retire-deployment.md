# SOP: Retire a Linux deployment

Take a deployment's servers away and, optionally, redirect its hostnames to the deployment that replaced it.
It takes three `pulumi up` runs, and a human runs each. **[dev-OTS]**
Destroying instances and backups is the destructive part; confirm the backups are kept first ([LNXBAK](../spec/linux/backups.md#repository-bucket)).

The reason for two runs is in the stack config: the redirect records have the same names as the server records, and Pulumi deletes resources dropped from a program last, so asking for both at once tries to create an alias over a record that still exists, which Route 53 refuses.

1. Set `tamanu-on-linux:retired: true` alone. Preview with the policy pack. **[diagnose]** `facilities` (and `central`) must stay in the config: the redirected hostnames derive from them.
2. A human runs `pulumi up`. It removes instances, the security group, the instance backup plan, roles, users and DNS-01 users, and their DNS records. **[dev-OTS]** The repository bucket is marked `protect: true` in the stack and Pulumi refuses to delete it, so the run ends with that one error. That is expected: the bucket stays until step 6.
3. Set `tamanu-on-linux:retiredTargetBase` to the replacement base domain. Add `retiredHostMap` entries for labels the replacement names differently.
4. Preview, then a human runs `pulumi up` again. It creates a CloudFront distribution with a function that answers every retired hostname with a 301 to the same path and query under the replacement. **[dev-OTS]**
5. A deployment with nothing to redirect to never takes step 3.
6. Thirty days after the last backup was written, when every object's lock has expired, a developer lifts the protection and runs `pulumi up` once more, which removes the bucket and its roles ([LNXAWS](../spec/linux/aws.md#retired-deployments)). **[dev-OTS]** Before that, confirm nothing still needs the backups: a clone deployment writes to the bucket of the deployment it clones ([LNXBAK](../spec/linux/backups.md#clone-deployments)).

   ```sh
   pulumi stack export | jq -r '.deployment.resources[] | select(.type == "aws-native:s3:Bucket") | .urn'
   pulumi state unprotect <urn>
   pulumi up
   ```

   The run fails while any object is still locked; wait and run it again.

The outputs `urls` and server outputs are empty for a retired deployment; `redirectsTo` maps each hostname to its target ([stack reference](../reference/linux-pulumi-config.md#outputs)).
