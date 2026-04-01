# Kopia backups

Creates an S3 bucket and associates roles and users for use by Kopia backups.

You should have one stack, and thus one bucket and set of roles/users per Kopia backup repository.

For Tamanu deployments, use the `tamanu/on-linux` stack instead, which includes dedicated support.

## Config: `bucketName`

Type: `string`

By default, the bucket name is generated from the stack name.
This config overrides it.
By convention this should begin with `bes-` and contain `kopia-backups`.
Avoid the prefix `bes-tamanu-kopia-backups`.

## Config: `tags`

Type: `{ [key: string]: string }`

By default, a `Purpose: backups` tag is applied to the bucket and associated resources.
You can add more tags using this config.

## Config: `users`

Type: `string[]`

By default, no users are created.
Add names here to create managed users for Kopia to use.
By convention, you should have one user per server.
