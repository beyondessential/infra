//! How pods reach the crypto key. The Secret itself is created by the stub, and
//! is only referenced here by name.

use k8s_openapi::api::core::v1::{EnvVar, KeyToPath, SecretVolumeSource, Volume, VolumeMount};

use crate::names::CRYPTO_SECRET;
use crate::pod::{env, env_secret};

const VOLUME_NAME: &str = "crypto-key";
const KEY_FILE_KEY: &str = "configKey";
const SETTINGS_PSK_KEY: &str = "settingsPsk";
const MOUNT_PATH: &str = "/secrets";

pub fn volume() -> Volume {
	Volume {
		name: VOLUME_NAME.into(),
		secret: Some(SecretVolumeSource {
			secret_name: Some(CRYPTO_SECRET.into()),
			default_mode: Some(0o400),
			items: Some(vec![KeyToPath {
				key: KEY_FILE_KEY.into(),
				path: KEY_FILE_KEY.into(),
				mode: None,
			}]),
			optional: None,
		}),
		..Default::default()
	}
}

pub fn volume_mount() -> VolumeMount {
	VolumeMount {
		name: VOLUME_NAME.into(),
		mount_path: MOUNT_PATH.into(),
		read_only: Some(true),
		..Default::default()
	}
}

pub fn envs() -> Vec<EnvVar> {
	vec![
		env("CRYPTO_KEY_FILE", format!("{MOUNT_PATH}/{KEY_FILE_KEY}")),
		env_secret("CRYPTO_SETTINGS_PSK", CRYPTO_SECRET, SETTINGS_PSK_KEY),
	]
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn key_file_is_inside_the_mount() {
		let envs = envs();
		assert_eq!(envs[0].value.as_deref(), Some("/secrets/configKey"));
		assert_eq!(volume_mount().mount_path, "/secrets");
		assert_eq!(volume().secret.unwrap().default_mode, Some(256));
	}
}
