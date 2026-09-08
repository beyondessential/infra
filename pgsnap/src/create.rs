use std::sync::Arc;
use std::time::Duration;

use k8s_openapi::api::batch::v1::Job;
use kube::{Api, Client, ResourceExt, api::PatchParams};
use semver::Version;
use kube::runtime::controller::Action;
use serde_json::json;
use tracing::{info, warn};

use crate::{cnpg, snapshot, util};

pub struct Context {
    pub client: Client,
    pub namespace: String,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("kube error: {0}")]
    Kube(#[from] kube::Error),
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, Clone, PartialEq)]
enum Phase {
    New,
    ClusterCreating,
    JobRunning,
    SnapshotWaiting,
    Complete,
    Failed,
}

impl Phase {
    fn from_str(s: &str) -> Self {
        match s {
            "cluster-creating" => Self::ClusterCreating,
            "job-running" => Self::JobRunning,
            "snapshot-waiting" => Self::SnapshotWaiting,
            "complete" => Self::Complete,
            "failed" => Self::Failed,
            _ => Self::New,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::ClusterCreating => "cluster-creating",
            Self::JobRunning => "job-running",
            Self::SnapshotWaiting => "snapshot-waiting",
            Self::Complete => "complete",
            Self::Failed => "failed",
        }
    }
}

pub async fn reconcile(job: Arc<Job>, ctx: Arc<Context>) -> Result<Action, Error> {
    let name = job.name_any();
    let annotations = job.annotations();

    // s[create.cleanup]
    // The Job's uid stamps ownerReferences on the Cluster + Secret so kube
    // GC cascades their deletion if the Job is removed (TTL or manual)
    // before the reconciler has cleaned up.
    let job_uid = job
        .metadata
        .uid
        .clone()
        .ok_or_else(|| Error::Other(anyhow::anyhow!("job {name} has no uid")))?;

    let phase = annotations
        .get(util::ANNOTATION_PHASE)
        .map(|s| Phase::from_str(s))
        .unwrap_or(Phase::New);

    let storage_size = annotations
        .get(util::ANNOTATION_SIZE)
        .map(|s| s.as_str())
        .unwrap_or(util::DEFAULT_STORAGE_SIZE);

    let cpu = annotations
        .get(util::ANNOTATION_CPU)
        .map(|s| s.as_str())
        .unwrap_or(util::DEFAULT_CPU);

    let memory = annotations
        .get(util::ANNOTATION_MEMORY)
        .map(|s| s.as_str())
        .unwrap_or(util::DEFAULT_MEMORY);

    let cluster_name = annotations
        .get(util::ANNOTATION_CLUSTER_NAME)
        .cloned()
        .unwrap_or_else(|| util::cluster_name_for_job(&name));

    let from_snapshot = annotations.get(util::ANNOTATION_FROM_SNAPSHOT).cloned();

    // s[annotation.snapshot]
    let wants_snapshot = annotations
        .get(util::ANNOTATION_SNAPSHOT)
        .map(|s| s != "false")
        .unwrap_or(true);

    match phase {
        Phase::New => {
            info!(job = %name, "starting pgsnap workflow");

            // s[annotation.from-snapshot]
            let source = match &from_snapshot {
                Some(requested) => {
                    let for_version = annotations
                        .get(util::ANNOTATION_FOR_VERSION)
                        .and_then(|v| Version::parse(v).ok());
                    let resolved = match snapshot::resolve_source(
                        &ctx.client,
                        &ctx.namespace,
                        requested,
                        for_version.as_ref(),
                    )
                    .await
                    {
                        Ok(resolved) => resolved,
                        // A source that does not exist will not appear on a retry. The Job
                        // never ran, so neither activeDeadlineSeconds nor
                        // ttlSecondsAfterFinished will ever reap it: delete it here, and a
                        // waiter reads either the phase or the Job going missing.
                        Err(err) => {
                            warn!(job = %name, requested = %requested, error = %err, "cannot resolve source snapshot");
                            set_annotations(&ctx.client, &ctx.namespace, &name, &[
                                (util::ANNOTATION_PHASE, Phase::Failed.as_str()),
                            ])
                            .await?;
                            delete_job(&ctx.client, &ctx.namespace, &name).await?;
                            return Ok(Action::await_change());
                        }
                    };

                    info!(job = %name, requested = %requested, snapshot = %resolved, "restoring from snapshot");
                    Some(resolved)
                }
                None => None,
            };

            // s[create.cluster]
            cnpg::create_cluster(
                &ctx.client,
                &ctx.namespace,
                &cluster_name,
                &cnpg::ClusterSpec {
                    storage_size,
                    cpu,
                    memory,
                    from_snapshot: source.as_deref(),
                },
                &cnpg::JobOwner { name: &name, uid: &job_uid },
            )
            .await?;

            set_annotations(&ctx.client, &ctx.namespace, &name, &[
                (util::ANNOTATION_PHASE, Phase::ClusterCreating.as_str()),
                (util::ANNOTATION_CLUSTER_NAME, &cluster_name),
            ])
            .await?;

            Ok(Action::requeue(Duration::from_secs(10)))
        }

        Phase::ClusterCreating => {
            // s[create.cluster.ready]
            if !cnpg::is_cluster_ready(&ctx.client, &ctx.namespace, &cluster_name).await? {
                return Ok(Action::requeue(Duration::from_secs(10)));
            }

            info!(job = %name, "CNPG Cluster ready");

            // s[create.secret]
            cnpg::create_connection_secret(
                &ctx.client,
                &ctx.namespace,
                &name,
                &cluster_name,
                from_snapshot.is_some(),
                &cnpg::JobOwner { name: &name, uid: &job_uid },
            )
            .await?;

            // s[create.unsuspend]
            unsuspend_job(&ctx.client, &ctx.namespace, &name).await?;

            set_annotations(&ctx.client, &ctx.namespace, &name, &[
                (util::ANNOTATION_PHASE, Phase::JobRunning.as_str()),
            ])
            .await?;

            Ok(Action::requeue(Duration::from_secs(15)))
        }

        Phase::JobRunning => {
            // s[create.wait-completion]
            let status = job.status.as_ref();
            let succeeded = status.and_then(|s| s.succeeded).unwrap_or(0) > 0;
            let failed = status.and_then(|s| s.failed).unwrap_or(0) > 0;

            if succeeded {
                // s[create.snapshot.suppressed]
                if !wants_snapshot {
                    info!(job = %name, "job succeeded, no snapshot asked for, cleaning up");
                    cnpg::delete_cluster(&ctx.client, &ctx.namespace, &cluster_name).await?;

                    set_annotations(&ctx.client, &ctx.namespace, &name, &[
                        (util::ANNOTATION_PHASE, Phase::Complete.as_str()),
                    ])
                    .await?;

                    return Ok(Action::await_change());
                }

                info!(job = %name, "job succeeded, creating snapshot");

                let snapshot_name = util::snapshot_name_for_job(&name);
                let passthrough = util::passthrough_annotations(annotations);

                // s[create.snapshot]
                snapshot::create_snapshot(
                    &ctx.client,
                    &ctx.namespace,
                    &snapshot_name,
                    &cluster_name,
                    passthrough,
                )
                .await?;

                set_annotations(&ctx.client, &ctx.namespace, &name, &[
                    (util::ANNOTATION_PHASE, Phase::SnapshotWaiting.as_str()),
                    (util::ANNOTATION_SNAPSHOT_NAME, &snapshot_name),
                ])
                .await?;

                return Ok(Action::requeue(Duration::from_secs(10)));
            }

            if failed {
                // s[create.failure]
                warn!(job = %name, "job failed, cleaning up");
                cnpg::delete_cluster(&ctx.client, &ctx.namespace, &cluster_name).await?;

                set_annotations(&ctx.client, &ctx.namespace, &name, &[
                    (util::ANNOTATION_PHASE, Phase::Failed.as_str()),
                ])
                .await?;

                return Ok(Action::await_change());
            }

            Ok(Action::requeue(Duration::from_secs(15)))
        }

        Phase::SnapshotWaiting => {
            let snapshot_name = match annotations.get(util::ANNOTATION_SNAPSHOT_NAME) {
                Some(n) => n.clone(),
                None => {
                    warn!(job = %name, "snapshot-waiting but no snapshot name annotation");
                    return Ok(Action::requeue(Duration::from_secs(10)));
                }
            };

            // s[create.snapshot.ready]
            if !snapshot::is_snapshot_ready(&ctx.client, &ctx.namespace, &snapshot_name).await? {
                return Ok(Action::requeue(Duration::from_secs(10)));
            }

            info!(job = %name, snapshot = %snapshot_name, "snapshot ready");

            // s[create.cleanup]
            cnpg::delete_cluster(&ctx.client, &ctx.namespace, &cluster_name).await?;

            set_annotations(&ctx.client, &ctx.namespace, &name, &[
                (util::ANNOTATION_PHASE, Phase::Complete.as_str()),
            ])
            .await?;

            Ok(Action::await_change())
        }

        Phase::Complete | Phase::Failed => Ok(Action::await_change()),
    }
}

pub fn error_policy(job: Arc<Job>, error: &Error, _ctx: Arc<Context>) -> Action {
    let name = job.name_any();
    warn!(job = %name, error = %error, "reconcile error, retrying");
    Action::requeue(Duration::from_secs(30))
}

async fn set_annotations(
    client: &Client,
    namespace: &str,
    job_name: &str,
    pairs: &[(&str, &str)],
) -> Result<(), kube::Error> {
    let jobs: Api<Job> = Api::namespaced(client.clone(), namespace);
    let mut annotations = serde_json::Map::new();
    for (k, v) in pairs {
        annotations.insert(k.to_string(), json!(v));
    }

    let patch = json!({
        "metadata": {
            "annotations": annotations,
        }
    });

    jobs.patch(
        job_name,
        &PatchParams::apply("pgsnap"),
        &kube::api::Patch::Merge(&patch),
    )
    .await?;
    Ok(())
}

async fn delete_job(client: &Client, namespace: &str, job_name: &str) -> Result<(), kube::Error> {
    let jobs: Api<Job> = Api::namespaced(client.clone(), namespace);
    jobs.delete(job_name, &Default::default()).await?;
    warn!(job_name, "deleted job");
    Ok(())
}

async fn unsuspend_job(
    client: &Client,
    namespace: &str,
    job_name: &str,
) -> Result<(), kube::Error> {
    let jobs: Api<Job> = Api::namespaced(client.clone(), namespace);
    let patch = json!({
        "spec": {
            "suspend": false,
        }
    });
    jobs.patch(
        job_name,
        &PatchParams::apply("pgsnap"),
        &kube::api::Patch::Merge(&patch),
    )
    .await?;
    info!(job_name, "unsuspended job");
    Ok(())
}
