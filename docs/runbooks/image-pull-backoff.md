# Runbook: pods stuck in ImagePullBackOff (image tag missing)

Pods of a deployment cannot pull their image and the Application stays Degraded.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

`kubectl -n tamanu-<stack> get pods` shows `ImagePullBackOff` or `ErrImagePull`.

## 2. Establish context

Which deployment, which Deployment's pods, and the `imageTag` in its config: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **Which image**: `kubectl -n tamanu-<stack> describe pod <pod>` shows the image and the pull error. **[diagnose]**
2. **Whether the tag exists** on the registry: the packages of the Tamanu repository, for example [`tamanu-central`](https://github.com/beyondessential/tamanu/pkgs/container/tamanu-central). The images are `ghcr.io/beyondessential/tamanu-central`, `tamanu-facility`, `tamanu-frontend`, `tamanu-patient-portal`, and `tamanu-synthetic-tests` ([config reference](../reference/tamanu-deployment-config.md#required)). **[diagnose]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Only `synthetic-tests` pods fail | Tamanu CD builds the central, facility, frontend and patient portal images for every pull request, but the synthetic tests image only for `main` and release branches (`cd-synthetic-tests.yml` in the Tamanu repository). A pull request deployment with the synthetic option fails here. | Remove the option and update, or scale the Deployment to zero. |
| Every pod of an image fails | The tag does not exist: a mistyped `imageTag`, or the build has not finished or failed. | Fix the tag, or wait for the build, then update. |
| The tag exists | A registry or node pull problem. | Escalate. |

## 5. Resolve

- Remove the option and update the stack ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.
- Scaling `synthetic-tests` to zero: `kubectl -n tamanu-<stack> scale deploy/synthetic-tests --replicas=0` **[dev-OTS]**. Argo CD ignores replica counts, so the scale-down stays ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#ignored-differences)).

## 6. Escalate

Escalate when the tag exists and pulls still fail.
Give the pod's pull error and the node it ran on.
