//! The legacy `raw` and `reporting` roles and the grants Job that reconciles
//! `app`'s role memberships. Ported from `reportingRoles.ts` and
//! `reportingGrants.ts` in the `tamanu-on-k8s` Pulumi project.

use anyhow::Result;
use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::{Container, PodSpec, PodTemplateSpec};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Config;
use crate::names;
use crate::pod::{env, env_secret};
use crate::postgres::{DEFAULT_POSTGRES_VERSION, ManagedRole};
use crate::waves;

/// The managed roles and init SQL for a server's cluster. The passwords are in
/// the Secrets [`names::raw_db_secret`] and [`names::reporting_db_secret`].
///
/// `app` must not be a managed role: CNPG forces every attribute of a managed
/// role back to the manifest and revokes memberships not listed in `inRoles`,
/// which strips the ADMIN OPTION grants [`reporting_grants`] applies (and
/// `inRoles` cannot express ADMIN OPTION). CREATEROLE on `app` is reconciled by
/// that Job instead.
///
/// The init SQL runs before the app migrates, so the reporting schema does not
/// exist yet. The ALTER grants `app` CREATEROLE at first bootstrap; the grants
/// Job covers existing clusters on each deploy. `raw` and `reporting` are
/// legacy and unused by Tamanu.
pub fn reporting_roles(server: &str) -> (Vec<ManagedRole>, String) {
	let roles = vec![
		ManagedRole {
			name: "raw".into(),
			password_secret: names::raw_db_secret(server),
			login: true,
		},
		ManagedRole {
			name: "reporting".into(),
			password_secret: names::reporting_db_secret(server),
			login: true,
		},
	];
	let init_sql = [
		"CREATE ROLE raw LOGIN;",
		"CREATE ROLE reporting LOGIN;",
		"GRANT USAGE ON SCHEMA public TO raw;",
		"GRANT SELECT ON ALL TABLES IN SCHEMA public TO raw;",
		"ALTER ROLE app CREATEROLE;",
	]
	.join("\n");
	(roles, init_sql)
}

/// Tamanu's app role self-manages the `tamanu_reporting` and `tamanu_raw` roles,
/// which on Postgres 16+ requires ADMIN OPTION on them, implicit only when `app`
/// created them. Snapshot-seeded and pre-existing clusters have the roles
/// without the grant, which crash-loops every server on startup. The block is a
/// no-op when the roles are absent (a fresh cluster: `app` creates them itself)
/// or already granted. CREATEROLE is reconciled here too, since initSql only
/// runs at first bootstrap.
///
/// Named dollar-quoting: kubelet command expansion collapses an anonymous `$$`
/// to `$`.
const GRANTS_SQL: &str = "DO $do$
BEGIN
  ALTER ROLE app WITH CREATEROLE;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'tamanu_reporting') THEN
    GRANT tamanu_reporting TO app WITH ADMIN OPTION;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'tamanu_raw') THEN
    GRANT tamanu_raw TO app WITH ADMIN OPTION;
  END IF;
END $do$;";

/// Reconciles the reporting-role grants as superuser on every sync, before the
/// app boots.
///
/// The Job is named `{server}-reporting-grants`. The TypeScript suffixed a
/// per-deploy timestamp so every `pulumi up` replaced it; as a `Sync` hook that
/// is deleted before it is recreated it reruns on every sync under a stable
/// name, so the suffix and its `ttlSecondsAfterFinished` cleanup are gone.
///
/// It runs in the migrate wave: it reads the superuser Secret CNPG creates with
/// the cluster, and a pod whose Secret is missing never starts, so it never
/// fails either and would hold the whole sync.
pub fn reporting_grants(cfg: &Config, server: &str) -> Result<Value> {
	let job = Job {
		metadata: ObjectMeta {
			name: Some(format!("{server}-reporting-grants")),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(JobSpec {
			// Generous: the superuser Secret can lag cluster creation.
			backoff_limit: Some(8),
			template: PodTemplateSpec {
				metadata: None,
				spec: Some(PodSpec {
					restart_policy: Some("Never".into()),
					containers: vec![Container {
						name: "grants".into(),
						image: Some(format!("postgres:{DEFAULT_POSTGRES_VERSION}")),
						command: Some(vec!["psql".into()]),
						args: Some(
							["-v", "ON_ERROR_STOP=1", "-c", GRANTS_SQL]
								.map(String::from)
								.to_vec(),
						),
						env: Some(vec![
							env("PGHOST", names::db_rw_service(server)),
							env("PGDATABASE", "app"),
							env("PGUSER", "postgres"),
							env_secret(
								"PGPASSWORD",
								&names::db_superuser_secret(server),
								"password",
							),
						]),
						..Default::default()
					}],
					..Default::default()
				}),
			},
			..Default::default()
		}),
		..Default::default()
	};
	Ok(waves::hook(serde_json::to_value(job)?, waves::MIGRATE))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn roles_reference_the_stub_secrets() {
		let (roles, sql) = reporting_roles("facility-1");
		assert_eq!(roles.len(), 2);
		assert_eq!(roles[0].name, "raw");
		assert_eq!(roles[0].password_secret, "facility-1-raw-db");
		assert_eq!(roles[1].password_secret, "facility-1-reporting-db");
		assert!(roles.iter().all(|r| r.login));
		assert!(sql.starts_with("CREATE ROLE raw LOGIN;\n"));
		assert!(sql.ends_with("ALTER ROLE app CREATEROLE;"));
		assert!(!sql.contains("  "));
	}
}
