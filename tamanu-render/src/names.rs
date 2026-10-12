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
