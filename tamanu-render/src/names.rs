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

/// The app service account, which carries the IAM role annotation when the
/// `serviceAccount` config is set.
pub const SERVICE_ACCOUNT: &str = "app-sa";

/// Secret: the application's connection string for a server's database, with
/// the key [`DB_URL_KEY`]. Created by the stub.
pub fn db_url_secret(server: &str) -> String {
	format!("{server}-db-url")
}

/// The key in [`db_url_secret`] holding the `app` role's connection string.
pub const DB_URL_KEY: &str = "app.dburl";

/// Secret: CNPG's credentials for the `app` role, with `username` and
/// `password` keys. Created by CNPG with the cluster.
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

/// Secret: central's URL with the provisioned admin's credentials embedded
/// (percent-encoded), under the key [`SYNC_URL_KEY`]. The facility's setup-sync
/// Job seeds it into the facility's sync facts. Created by the stub.
pub fn facility_sync_url_secret(server: &str) -> String {
	format!("{server}-sync-url")
}

pub const SYNC_URL_KEY: &str = "url";

/// Keys of [`db_url_secret`] beyond [`DB_URL_KEY`], from `postgresUrl.ts`. The
/// stub fills them from CNPG's `app` and superuser passwords, with `name` the
/// server (`central` or `facility-N`), `rw` and `ro` its `{name}-db-rw` and
/// `{name}-db-ro` Services, and `P` the relevant password:
///
/// - `app.password`: the app role's password.
/// - `app.dburl`: `postgres://app:P@rw/app`.
/// - `app.jdbc`: `jdbc:postgresql://rw/app?user=app&password=P`.
/// - `app.rodburl`: `postgres://app:P@ro/app?sslmode=disable`.
/// - `app.localdburl`: `postgres://app:P@localhost:5433/app`.
/// - `app.localjdbc`: `jdbc:postgresql://localhost:5433/app?user=app&password=P`.
/// - `postgres.password`: the superuser's password.
/// - `postgres.dburl`: `postgres://postgres:P@rw/postgres`.
/// - `postgres.localdburl`: `postgres://postgres:P@localhost:5433/postgres`.
/// - `postgres.localjdbc`: `jdbc:postgresql://localhost:5433/postgres?user=postgres&password=P`.
///
/// The Secret is labelled `app.kubernetes.io/name: {name}` and
/// `app.kubernetes.io/component: database`.
pub mod db_url_key {
	pub const APP_PASSWORD: &str = "app.password";
	pub const APP_RO_DB_URL: &str = "app.rodburl";
	pub const APP_JDBC_URL: &str = "app.jdbc";
}
