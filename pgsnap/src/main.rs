mod cnpg;
mod create;
mod gc;
mod snapshot;
mod util;

use std::{net::SocketAddr, sync::Arc};

use axum::{Router, routing::get};
use futures::StreamExt;
use k8s_openapi::api::batch::v1::Job;
use kube::{
    Api, Client,
    runtime::controller::Controller,
};
use prometheus::{Encoder, TextEncoder};
use tokio::signal;
use tracing::{error, info};

// s[runtime.binary]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("failed to install rustls crypto provider");

    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pgsnap=info,kube=info".into()),
        )
        .init();

    let client = Client::try_default().await?;
    let namespace = util::operator_namespace()?;
    info!(namespace, "pgsnap operator starting");

    let ctx = Arc::new(create::Context {
        client: client.clone(),
        namespace: namespace.clone(),
    });

    // s[runtime.health] s[runtime.metrics]
    let health_ctx = ctx.clone();
    let health_server = tokio::spawn(async move {
        let app = Router::new()
            .route("/livez", get(|| async { "ok" }))
            .route("/readyz", get({
                let ctx = health_ctx;
                move || {
                    let ctx = ctx.clone();
                    async move {
                        match Api::<Job>::namespaced(ctx.client.clone(), &ctx.namespace)
                            .list(&Default::default())
                            .await
                        {
                            Ok(_) => (axum::http::StatusCode::OK, "ok"),
                            Err(_) => (axum::http::StatusCode::SERVICE_UNAVAILABLE, "not ready"),
                        }
                    }
                }
            }))
            .route("/metrics", get(|| async {
                let encoder = TextEncoder::new();
                let content_type = encoder.format_type().to_owned();
                let metric_families = prometheus::gather();
                let mut buffer = Vec::new();
                encoder.encode(&metric_families, &mut buffer).unwrap();
                (
                    [(axum::http::header::CONTENT_TYPE, content_type)],
                    buffer,
                )
            }));

        let addr = SocketAddr::from((std::net::Ipv6Addr::UNSPECIFIED, 8080));
        info!(%addr, "health server listening");
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        axum::serve(listener, app).await.unwrap();
    });

    // s[gc.schedule]
    let gc_client = client.clone();
    let gc_ns = namespace.clone();
    let gc_task = tokio::spawn(async move {
        gc::run_loop(gc_client, &gc_ns).await;
    });

    // s[create.scheduling]
    // Jobs must carry label pgsnap.bes.au/create=true for the controller to pick them up.
    // Annotations cannot be used for watch selection in Kubernetes.
    let jobs: Api<Job> = Api::namespaced(client.clone(), &namespace);
    let controller = Controller::new(jobs, kube::runtime::watcher::Config {
        label_selector: Some(format!("{}=true", util::LABEL_CREATE)),
        ..Default::default()
    })
    .shutdown_on_signal()
    .run(create::reconcile, create::error_policy, ctx)
    .for_each(|result| async move {
        match result {
            Ok(obj) => info!(name = %obj.0.name, "reconciled"),
            Err(e) => error!(error = %e, "reconcile failed"),
        }
    });

    tokio::select! {
        _ = controller => info!("controller exited"),
        _ = gc_task => info!("gc task exited"),
        _ = health_server => info!("health server exited"),
        _ = signal::ctrl_c() => info!("shutting down"),
    }

    Ok(())
}
