---
id: TSD
---

# Tamanu deployment scaledown

The requirements in this spec apply to every [deployment](../overview.md#tamanu-deployment) that has a [time to live](../overview.md#time-to-live), and to each cluster that hosts one.

## Borrowed terms

| term | meaning |
|---|---|
| Application | An Argo CD `Application`, the declaration of one deployment that Argo CD keeps in sync ([Argo CD declarative setup](https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/)). |
| Deployment | The Kubernetes workload resource. The capitalised word never means a deployment of Tamanu ([Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)). |
| database cluster | A CloudNativePG `Cluster`, a PostgreSQL primary with its replicas ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). |
| downscaler | The cluster component that scales workloads to zero and back, as their annotations direct ([py-kube-downscaler](https://github.com/caas-team/py-kube-downscaler)). |
| forced downtime | The state of a workload that carries the annotation `downscaler/force-downtime` with the value `true`. The downscaler holds the workload at zero replicas and keeps its previous replica count in the annotation `downscaler/original-replicas` ([py-kube-downscaler](https://github.com/caas-team/py-kube-downscaler)). |
| exclusion | The annotation `downscaler/exclude` with the value `true`, which removes a workload, or every workload of a namespace, from the downscaler's attention ([py-kube-downscaler](https://github.com/caas-team/py-kube-downscaler)). |
| database hibernation | The removal of the pods of a database cluster with its volumes retained, which the annotation `cnpg.io/hibernation=on` asks for and `cnpg.io/hibernation=off` reverses ([CloudNativePG declarative hibernation](https://cloudnative-pg.io/documentation/current/declarative_hibernation/)). |
| suspended CronJob | A CronJob with `suspend` set, which the CronJob controller never runs on its schedule ([Kubernetes CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)). |
| Create Job action | The Argo CD resource action that creates a Job from a CronJob ([Argo CD resource actions](https://argo-cd.readthedocs.io/en/stable/operator-manual/resource_actions/)). |

## Cluster downscaler

A cluster that hosts deployments MUST run the downscaler.

The downscaler MUST act on Deployments.

The downscaler MUST leave a workload alone when neither the workload nor its namespace carries a downscaler annotation.

The downscaler SHOULD evaluate workloads every 60 seconds.

The downscaler SHOULD run on a node with the label `bes.node.purpose=system`.

> [!NOTE]
> The downscaler is the component that restores replicas, so it sits on capacity that scaledown never frees.

## Time to live

A deployment MAY have a time to live.

A time to live is a whole number of hours, and zero means that the deployment has none.

The stub MUST refuse a time to live that is not a non-negative whole number.

On every update of a deployment that has a time to live, the stub MUST anchor the end of the time to live at the time of the update plus the time to live.

The stub MUST schedule [hibernation](../overview.md#hibernation) at the first of the minutes 00, 20 and 40 of an hour, in UTC, at or after the end of the time to live.

The stub SHOULD schedule a second hibernation 10 minutes after the first.

## Hibernation

Hibernating a deployment MUST set the annotation `downscaler/force-downtime=true` on every Deployment in its namespace.

Hibernating a deployment MUST set the annotation `cnpg.io/hibernation=on` on every database cluster in its namespace.

Hibernation MUST retain the volumes of the database clusters.

Hibernation MUST NOT remove or change any other object of the deployment, including its Services, Gateways, routes, configuration, the `wake` CronJob and the Application.

The namespace of a deployment MUST NOT carry a downscaler exclusion.

> [!NOTE]
> The downscaler skips every workload of an excluded namespace, so forced downtime set on its Deployments would have no effect.

The stub MUST create a service account named `tamanu-ttl` in the namespace of each deployment that has a time to live.

The steps of hibernation MUST run as that service account.

That service account MUST be able to get, list and patch Deployments and database clusters in that namespace.

That service account MUST NOT be able to act outside that namespace or on any other kind of object.

The Job that performs a step of hibernation SHOULD tolerate the spot taint of [K8SNOD](../kubernetes/nodes.md#node-identity).

How a sync treats the objects that hibernation changes is specified in [TDR](deployment-rollout.md#ignored-differences) and [TDR](deployment-rollout.md#database-health).

## Waking

[Waking](../overview.md#wake) a deployment MUST remove the annotation `downscaler/force-downtime` from every Deployment in its namespace.

Waking a deployment MUST set the annotation `cnpg.io/hibernation=off` on every database cluster in its namespace.

Waking a deployment MUST NOT change the end of its time to live.

The stub MUST wake a deployment that has a time to live on every update of it.

> [!NOTE]
> A deployment that has been hibernated at the end of its time to live is revived by the next update, and a woken deployment is then given a new time to live.

The steps of waking MUST run as the service account `tamanu-ttl`, which has the permissions given under [hibernation](#hibernation).

The renderer MUST render a CronJob named `wake` for a deployment that has a time to live.

The renderer MUST NOT render a `wake` CronJob for a deployment that has none.

The `wake` CronJob MUST be a suspended CronJob.

A Job created from the `wake` CronJob MUST wake the deployment.

A person MAY wake a hibernated deployment by running the Create Job action on its `wake` CronJob in Argo CD.

A person MAY wake a hibernated deployment by creating a Job from its `wake` CronJob with the Kubernetes command line.

The `wake` CronJob SHOULD allow one Job to run at a time.

The Job created from the `wake` CronJob SHOULD tolerate the spot taint of [K8SNOD](../kubernetes/nodes.md#node-identity).

The Argo CD of each cluster that hosts deployments MUST allow the role that operates deployments to run the Create Job action on the CronJobs of Applications in the `tamanu` project.
