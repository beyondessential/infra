//! The application service account, ported from `serviceAccount.ts`. It carries
//! the IAM role annotation, and pods use it only when `serviceAccount` is set.

use k8s_openapi::api::core::v1::ServiceAccount;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Config;
use crate::names;
use crate::waves;

pub fn service_account(cfg: &Config) -> serde_json::Result<Option<Value>> {
	let Some(role) = &cfg.service_account else {
		return Ok(None);
	};
	let sa = ServiceAccount {
		metadata: ObjectMeta {
			name: Some(names::SERVICE_ACCOUNT.into()),
			namespace: Some(cfg.namespace.clone()),
			annotations: Some([("eks.amazonaws.com/role-arn".to_owned(), role.clone())].into()),
			..Default::default()
		},
		..Default::default()
	};
	Ok(Some(waves::in_wave(serde_json::to_value(sa)?, waves::BASE)))
}
