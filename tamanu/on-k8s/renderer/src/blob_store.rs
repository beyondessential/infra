//! The shared blob store volume, ported from `common/blobStore.ts`.

use anyhow::Result;
use k8s_openapi::api::core::v1::{
	PersistentVolumeClaim, PersistentVolumeClaimSpec, PersistentVolumeClaimVolumeSource, Volume,
	VolumeMount, VolumeResourceRequirements,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Config;
use crate::waves;

const VOLUME_NAME: &str = "blob-store";
const STORAGE_CLASS: &str = "efs";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlobServer {
	Central,
	Facility,
}

impl BlobServer {
	/// `blobStorage.root` is a database-backed setting that defaults to a path
	/// relative to the server's working directory, which is its package
	/// directory in the image. Mounting there means a deployment needs no
	/// setting to land on shared storage.
	fn default_root(self) -> &'static str {
		match self {
			Self::Central => "/app/packages/central-server/data/blobs",
			Self::Facility => "/app/packages/facility-server/data/blobs",
		}
	}
}

pub struct BlobStore {
	pub claim: Value,
	pub volume: Volume,
	pub volume_mount: VolumeMount,
}

/// A claim named `{name}-blobs` and the volume and mount that use it.
pub fn blob_store_volume(cfg: &Config, name: &str, server: BlobServer) -> Result<BlobStore> {
	let claim_name = format!("{name}-blobs");
	let claim = PersistentVolumeClaim {
		// A fixed name so a replacement collides instead of silently provisioning
		// a second, empty volume.
		metadata: ObjectMeta {
			name: Some(claim_name.clone()),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(PersistentVolumeClaimSpec {
			access_modes: Some(vec!["ReadWriteMany".into()]),
			storage_class_name: Some(STORAGE_CLASS.into()),
			// EFS grows on demand and enforces no quota; the field is required.
			resources: Some(VolumeResourceRequirements {
				requests: Some([("storage".to_owned(), Quantity("1Gi".into()))].into()),
				limits: None,
			}),
			..Default::default()
		}),
		..Default::default()
	};

	Ok(BlobStore {
		claim: waves::in_wave(serde_json::to_value(claim)?, waves::BASE),
		volume: Volume {
			name: VOLUME_NAME.into(),
			persistent_volume_claim: Some(PersistentVolumeClaimVolumeSource {
				claim_name,
				read_only: None,
			}),
			..Default::default()
		},
		volume_mount: VolumeMount {
			name: VOLUME_NAME.into(),
			mount_path: server.default_root().into(),
			..Default::default()
		},
	})
}
