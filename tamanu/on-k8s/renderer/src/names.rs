//! Names the renderer and the Pulumi stub agree on.
//!
//! The stub creates every Secret listed here, since secret values are never
//! rendered. `server` is `central` or `facility-N`.

pub fn db_cluster(server: &str) -> String {
	format!("{server}-db")
}

/// The rendered application config for a server.
pub fn app_config(server: &str) -> String {
	format!("config-{server}")
}

/// Central's rendered provisioning config.
pub const PROVISIONING_CONFIG: &str = "provisioning";

/// Secret: the crypto key file and encrypted settings PSK. Created by the stub.
pub const CRYPTO_SECRET: &str = "tamanu-crypto";

/// Secret: password for the legacy `raw` role. Created by the stub.
pub fn raw_db_secret(server: &str) -> String {
	format!("{server}-raw-db")
}

/// Secret: password for the legacy `reporting` role. Created by the stub.
pub fn reporting_db_secret(server: &str) -> String {
	format!("{server}-reporting-db")
}

/// The service account the TTL schedule's Jobs run as, made by the stub. It may
/// patch the deployments and database clusters of its namespace.
pub const TTL_SERVICE_ACCOUNT: &str = "tamanu-ttl";

/// The service account the quiesce and resume Jobs run as, rendered with them.
/// It may scale the deployments and list the pods of its namespace.
pub const QUIESCE_SERVICE_ACCOUNT: &str = "tamanu-quiesce";

/// The app service account, which carries the IAM role annotation when the
/// `serviceAccount` config is set.
pub const SERVICE_ACCOUNT: &str = "app-sa";

/// Secret: CNPG's credentials for the `app` role, with `username`, `password`
/// and `uri` keys, the last being the connection string the servers use.
/// Created by CNPG with the cluster.
pub fn db_app_secret(server: &str) -> String {
	format!("{server}-db-app")
}

/// Secret: CNPG's superuser credentials, with a `password` key. Created by CNPG
/// with the cluster.
pub fn db_superuser_secret(server: &str) -> String {
	format!("{server}-db-superuser")
}

/// The read-write Service CNPG creates in front of a cluster's primary.
pub fn db_rw_service(server: &str) -> String {
	format!("{}-rw", db_cluster(server))
}

/// The key in [`db_app_secret`] holding the `app` role's connection string.
pub const DB_APP_URI_KEY: &str = "uri";

/// Secret: signing secrets for a server's auth tokens, under [`AUTH_SECRET_KEY`]
/// and, for central only, [`AUTH_REFRESH_SECRET_KEY`]. The rendered config holds
/// placeholders for these paths, and the server reads the environment instead.
/// Created by the stub.
pub fn config_secrets(server: &str) -> String {
	format!("config-secrets-{server}")
}

pub const AUTH_SECRET_KEY: &str = "authSecret";
pub const AUTH_REFRESH_SECRET_KEY: &str = "authRefreshSecret";
