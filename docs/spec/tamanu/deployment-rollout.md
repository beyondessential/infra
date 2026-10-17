---
id: TDR
---

# Tamanu deployment rollout

The requirements in this spec apply to every [deployment](../overview.md#tamanu-deployment): the objects the [renderer](../overview.md#renderer) produces for it, and the Application that the [stub](../overview.md#stub) creates to apply them.
In this spec, `<server>` is `central` or `facility-N`, where N numbers the facilities of a deployment from 1.

## Borrowed terms

| term | meaning |
|---|---|
| Application | An Argo CD `Application`, the declaration of one deployment that Argo CD keeps in sync ([Argo CD declarative setup](https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/)). |
| sync wave | An integer on a resource that orders it within one sync. A wave starts when every resource of the lower waves is synced and healthy ([Argo CD sync phases and waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/)). |
| sync hook | A resource that Argo CD runs during a sync instead of keeping applied. A hook that is deleted before it is created again runs afresh on every sync ([Argo CD resource hooks](https://argo-cd.readthedocs.io/en/stable/user-guide/resource_hooks/)). |
| Synced, Healthy | The sync status and the health status that Argo CD reports for an Application ([Argo CD resource health](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/)). |
| automated sync, prune, self-heal | The sync policy under which Argo CD applies changes without being asked, deletes resources the render no longer produces, and reverts drift of the live cluster ([Argo CD automated sync policy](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)). |
| ignored difference | A field that Argo CD leaves out of its comparison of the render with the live object ([Argo CD diffing customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)). |
| respect ignored differences | The sync option under which an ignored field also keeps its live value when Argo CD applies the render ([Argo CD sync options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/#respect-ignore-difference-configs)). |
| Deployment | The Kubernetes workload resource. The capitalised word never means a deployment of Tamanu ([Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)). |
| recreate | The Deployment update strategy that stops every old pod before it starts a new one ([Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)). |
| node affinity | A required or preferred match of a pod against node labels ([Kubernetes assigning pods to nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)). |
| topology spread constraint | A limit on how unevenly the pods of a workload sit across nodes ([Kubernetes pod topology spread constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)). |
| toleration | The permission for a pod to run on a node with a matching taint ([Kubernetes taints and tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)). |
| PodDisruptionBudget | A limit on how many pods of a workload may be voluntarily disrupted at once ([Kubernetes disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)). |
| startup probe, liveness probe | A startup probe holds back a container's readiness until the container has started, and a liveness probe restarts a container that has stopped responding ([Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)). |
| database cluster | A CloudNativePG `Cluster`, a PostgreSQL primary with its replicas ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). |

## Application

The stub MUST create one Application for each deployment.

The Application MUST be named as the namespace of the deployment, and MUST belong to the `tamanu` project.

The Application MUST apply the render of the deployment to that namespace.

The Application MUST use automated sync, with prune and self-heal.

The Application MUST use server-side apply and server-side diff.

> [!NOTE]
> The API server and its webhooks fill in fields that the render leaves unset.
> A diff made on the client reports those fields as drift without end, so the Application never reaches Synced.

The Application SHOULD retry a failed sync up to 5 times, starting 10 seconds after the failure, doubling the delay each time, up to 3 minutes.

Deleting the Application MUST delete every resource it created.

A deployment that restores its central database from a seed snapshot MUST have a copy of the snapshot in its namespace before the Application is created.

Which renderer renders an Application is specified in [TRO](renderer-rollout.md).

## Sync order

The renderer MUST place each resource of a deployment in the sync wave that the following table gives for it.

| wave | resources |
|---|---|
| 0 | The rendered configuration ConfigMaps, the application service account, the claim of each shared blob store, and the database clusters with their backup resources. |
| 1 | The `<server>-reporting-grants` and `<server>-migrator` Jobs. |
| 2 | The `central-provisioner` Job and the `facility-N-setup-sync` Jobs. |
| 3 | Deployments, Services, Gateways with their traffic policies, HTTPRoutes, PodDisruptionBudgets, the `central-db-tailscale` Service, the seed top-up Job, the synthetic tests Deployment, and the `wake` CronJob. |

A database cluster MUST be in an earlier wave than every Job and every server that connects to it.

A `<server>-migrator` Job MUST be in an earlier wave than the provisioner, the setup-sync Jobs and the servers.

A `<server>-reporting-grants` Job MUST be in an earlier wave than the servers, and in a later wave than its database cluster.

> [!NOTE]
> The Job reads a Secret that the database operator creates with the cluster.
> A pod whose Secret is missing never starts, so the Job neither completes nor fails, and the sync waits on it without end.

The `central-provisioner` Job MUST be in a later wave than the central migrator.

A `facility-N-setup-sync` Job MUST be in a later wave than the migrator of the same facility.

Every Service, Gateway, route and server MUST be in the last wave.

A route MUST NOT be applied before the Service it names.

> [!NOTE]
> Argo CD reports a route as unhealthy while its backend Service is missing.
> A wave completes only when everything in it is healthy, so a route in an earlier wave than its Service stalls the sync.

## Database health

The Argo CD of each cluster that hosts deployments MUST report a database cluster as Healthy once its Ready condition is true.

That Argo CD MUST report a database cluster as Healthy while the cluster carries the annotation `cnpg.io/hibernation=on`.

That Argo CD MUST give the health of a hibernated database cluster the message `Hibernated`.

> [!NOTE]
> A [promotion](../overview.md#promotion) reads that message to tell a hibernated deployment from an awake one.

That Argo CD MUST report any other database cluster as Progressing.

> [!NOTE]
> A database cluster has no health rule of its own in Argo CD, so without these rules it is Healthy the moment it exists, and a wave that waits on health would not wait for the database.

## Hook Jobs

The `<server>-reporting-grants`, `<server>-migrator`, `central-provisioner` and `facility-N-setup-sync` Jobs MUST be sync hooks that Argo CD deletes before it creates them again.

A sync MUST run each of those Jobs, including a sync that changes nothing in the Tamanu image.

The command of each of those Jobs MUST be safe to run again against a database it has already run against.

## Version-gated steps

A step in the following table MUST be omitted from a deployment whose Tamanu version is lower than the version given for it.

| step | first version |
|---|---|
| the `facility-N-setup-sync` Job | 2.60.0, counting its pre-releases |
| the FHIR workers of a facility | 2.60.0, counting its pre-releases |
| the seed top-up Job | 2.65.0, counting its pre-releases |

A deployment whose Tamanu version is unknown MUST be treated as lower than every version in the table.

The Tamanu version of a deployment MUST be the version the stub read from the image, and MUST NOT be inferred from the image tag.

> [!NOTE]
> A Job that runs a subcommand the image lacks exits with an error and fails the sync.
> An unknown version therefore errs towards omitting the step.

## Seed top-up

A deployment MUST have a seed top-up Job only when it is configured to be topped up with generated data.

The seed top-up Job MUST run once for each image.

The name of the seed top-up Job MUST be derived from the image tag and MUST begin with `central-seed-top-up-`.

The seed top-up Job MUST NOT be a sync hook and MUST NOT have a time to live after it finishes.

A sync of an unchanged image MUST leave the Job as it is.

A sync of a new image MUST create the Job for that image and prune the Job of the previous image.

> [!NOTE]
> Each run adds more generated records.
> A Job that runs on every sync, or that is recreated after it is cleaned up, grows the data on each sync.

The renderer MUST refuse a deployment that is configured to be topped up with generated data when the environment setting of the deployment is `production`.

## Update strategy

A workload that must not run two instances at once MUST be updated by recreation.

The central task runner, the task runner of each facility, the sync server of each facility and the FHIR workers of each facility MUST be updated by recreation.

> [!NOTE]
> Stopping the old instance first avoids running scheduled tasks twice and doubling up on sync.

An API server and a web frontend MUST be updated by rolling update.

## Server health

An API server, a facility sync server and a web frontend MUST declare a startup probe and a liveness probe, each of which fetches `/` on port 3000.

The startup probe SHOULD poll every second and allow 60 failures before the container is restarted.

The liveness probe SHOULD poll every 10 seconds and restart the container after 2 failures.

> [!NOTE]
> A rolling update replaces pods only as their successors become ready, and a container is not ready before its startup probe succeeds.
> A server without the probe is ready as soon as its container starts.

## Replicas

The renderer MUST take the replica count of a workload from the setting for that workload on the central server or on facility servers where one is given, else from the setting for that workload on every server, else from the default.

The renderer MUST raise a count below its minimum to the minimum, and MUST lower a count above its maximum to the maximum.

The renderer MUST NOT refuse a count for being outside its range.

| workload | default | minimum | maximum |
|---|---|---|---|
| API server of the central server and of each facility | 2 | 0 | 5 |
| database cluster instances | 2 | 2 | 3 |
| task runner and FHIR workers | 1 | 0 | 1 |
| web frontend of the central server and of each facility | 2 | 0 | 5 |
| patient portal web frontend | 2 | none | none |

The sync server of each facility MUST have exactly one replica.

A facility whose task replica count is zero MUST have no task runner and no FHIR worker.

The central server of a deployment whose task replica count is zero MUST keep its task runner and its FHIR workers at zero replicas.

The synthetic tests Deployment MUST have exactly one replica.

How a sync treats the replica count of a live Deployment is specified under [ignored differences](#ignored-differences).

## Placement

A deployment has the settings in the following table.

| setting | values | default |
|---|---|---|
| capacity | `spot`, `ondemand` | `spot` |
| architecture | `arm64`, `amd64` | `arm64` |

The renderer MUST refuse a deployment whose capacity or architecture is not one of the listed values, with a message that names the value.

Every pod that the renderer defines for a server, a web frontend, the patient portal or the synthetic tests, including the pods of Jobs, MUST require a node with the label `bes.node.purpose=workload` and the label `bes.node.arch` equal to the architecture of the deployment.

A deployment with capacity `ondemand` MUST run those pods only on nodes with the label `bes.node.schedule=ondemand`.

A deployment with capacity `spot` SHOULD run those pods on nodes with the label `bes.node.schedule=spot`.

A deployment with capacity `spot` SHOULD give those pods a toleration of the taint `spotInstance=true:PreferNoSchedule`.

> [!NOTE]
> The spot preference is soft, so a pod runs on an on-demand node when no spot node has room.

The database clusters of a deployment MUST follow the capacity of the deployment.

A database cluster of a deployment on capacity `spot` MUST be placed as a [K8SPGC](../kubernetes/postgres.md#scheduling-and-disruption) cluster that opts into neither the critical database pool nor on-demand placement.

A database cluster of a deployment on capacity `ondemand` MUST be placed as a [K8SPGC](../kubernetes/postgres.md#scheduling-and-disruption) cluster that opts into on-demand placement.

The instances of a database cluster SHOULD run on nodes with the label `bes.node.arch=arm64`, whatever the architecture of the deployment.

The instances of a database cluster SHOULD all run in one availability zone.

A deployment MAY opt out of the single availability zone.

The replicated servers are those in the following table.

| replicated server | Service |
|---|---|
| central API | `central-api` |
| central web frontend | `central-web` |
| API of facility N | `facility-N-api` |
| web frontend of facility N | `facility-N-web` |
| patient portal web frontend | `patient-portal-web` |

The pods of each replicated server MUST be spread across nodes, so that no node hosts more than one pod more than any other node.

A pod that would break that spread MUST stay unscheduled.

The spread MUST be counted over the pods of the current rollout of the workload only.

> [!NOTE]
> A count over every rollout of the workload lets a rolling update surge onto nodes that already host a replica.

Each replicated server MUST have a PodDisruptionBudget that allows one pod to be unavailable.

The PodDisruptionBudget of a replicated server MUST bear the name of its Service.

The database clusters of a deployment MUST NOT keep the disruption budgets of the database operator unless the deployment asks to keep them.

## Ignored differences

The Application MUST ignore the differences in the following table, and MUST respect them when it syncs.

| resource | ignored field | changed by |
|---|---|---|
| Deployment | the replica count | the downscaler, and anyone who scales by hand |
| Deployment | the annotations `downscaler/force-downtime` and `downscaler/original-replicas` | hibernation and the downscaler |
| database cluster | the annotation `cnpg.io/hibernation` | hibernation and waking |
| ConfigMap `provisioning`, `config-central` and `config-facility-N` | `data` and `binaryData` | anyone who edits the configuration by hand |

> [!NOTE]
> A sync that applied these fields would undo a scaledown and discard hand edits on every sync.

Scaledown is specified in [TSD](scaledown.md).

## Update completion

The stub MUST NOT complete an update of a deployment until the Application of the deployment is Synced and Healthy.

The stub MUST fail an update when a sync operation of the Application finishes failed or in error after the update began.

The stub MUST NOT fail an update for a sync operation that finished before the update began.

> [!NOTE]
> That operation is the previous update's, which Argo CD replaces when it notices the new parameters.

The stub MUST fail an update when the Application is not Synced and Healthy within the wait limit.

The wait limit SHOULD default to 30 minutes.

The wait limit MAY be set for each deployment.
