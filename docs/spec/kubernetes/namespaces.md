---
id: K8SNSP
---

# Namespaces and access control

The requirements in this spec apply to every cluster that runs the shared services layer.
The requirements on namespaces and roles apply to every cluster that hosts [Tamanu deployments](../overview.md#tamanu-deployment).

## Borrowed terms

| term | meaning |
|---|---|
| Role, ClusterRole, RoleBinding, ClusterRoleBinding | The RBAC objects of Kubernetes. A RoleBinding grants a Role or ClusterRole within one namespace, and a ClusterRoleBinding grants a ClusterRole in every namespace and at cluster scope ([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)). |
| Kubernetes group | A name that the API server attaches to an authenticated caller and that a binding can use as its subject ([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)). |
| `view`, `cluster-admin` | The built-in ClusterRoles. `view` reads most objects of a namespace except Secrets, Roles and RoleBindings. `cluster-admin` permits every action on every resource ([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)). |
| `escalate`, `bind` | The verbs that let a caller create or update a Role or RoleBinding that grants permissions the caller does not itself hold ([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)). |
| API server proxy | The mode of the Tailscale operator in which it accepts Kubernetes API requests from the tailnet and forwards them to the API server as the Tailscale identity of the caller, with the Kubernetes groups that the tailnet policy assigns ([Tailscale Kubernetes operator API server proxy](https://tailscale.com/kb/1437/kubernetes-operator-api-server-proxy)). |
| tailnet policy | The access policy of the tailnet, whose grants decide who may reach a device and which Kubernetes groups a caller carries ([Tailscale grants](https://tailscale.com/kb/1324/grants)). |
| workload identity | A credential that a platform issues to one run of a workload and that Tailscale exchanges for a short-lived token ([Tailscale workload identity federation](https://tailscale.com/kb/1581/workload-identity-federation)). |
| EKS access entry | An EKS-managed mapping from an AWS IAM principal to Kubernetes permissions ([Amazon EKS access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html)). |
| HNC | The Hierarchical Namespace Controller, which arranges namespaces into trees ([HNC concepts](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/concepts.md)). |
| parent, child, descendant, subtree | The relations between namespaces in an HNC tree. A subtree is a namespace together with all of its descendants ([HNC concepts](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/concepts.md)). |
| subnamespace | A child namespace whose parent never changes and whose lifetime is bound to that parent ([HNC concepts](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/concepts.md)). |
| SubnamespaceAnchor | The object in a parent namespace whose creation makes HNC create the subnamespace of the same name, and whose deletion deletes that subnamespace ([HNC how-to](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/how-to.md)). |
| HierarchyConfiguration | The object named `hierarchy` in a namespace, whose `spec.parent` sets the parent of that namespace ([HNC concepts](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/concepts.md)). |
| propagation | HNC's copying of a source object in a namespace into every descendant namespace, and its keeping each copy in sync with the source ([HNC concepts](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/concepts.md)). |
| AppProject | The Argo CD grouping of Applications that limits their source repositories, destination namespaces and cluster-scoped kinds ([Argo CD projects](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/)). |
| default role | The Argo CD role that applies to a caller who has no role assigned ([Argo CD RBAC](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/)). |

## Cluster endpoint access

Once bootstrapped, a cluster MUST run the Tailscale operator with its API server proxy enabled.

A caller MUST NOT need a Kubernetes credential beyond its tailnet identity.

The tailnet hostname of the API server proxy MUST be `k8s-operator-` followed by the name of the cluster.

A stack that manages the in-cluster resources of a cluster MUST refuse to apply when the endpoint in its kubeconfig is neither the API server proxy of that cluster nor the direct endpoint of that cluster.

> [!NOTE]
> A kubeconfig left on another cluster would otherwise apply the configuration of one cluster to another.

A stack that manages only in-cluster resources MUST be applicable with a tailnet identity and no AWS credentials.

Automation SHOULD join the tailnet with a workload identity issued for the run, and SHOULD NOT use a stored credential.

## Tailscale operator

The Tailscale operator MUST run as the service account `operator` in the namespace `tailscale-system`.

> [!NOTE]
> The federated identity that Tailscale trusts for the operator names that service account as its subject.

The operator MUST authenticate to the Tailscale API with an OAuth client.

The operator SHOULD authenticate by exchanging an OIDC token that the cluster's issuer mints, and SHOULD NOT hold a stored client secret.

The OAuth client SHOULD carry only the scopes that the [Tailscale Kubernetes operator documentation](https://tailscale.com/kb/1236/kubernetes-operator) requires of it.

The device of the operator, and the device of each proxy it creates, MUST carry tags that the tailnet policy defines.

## Direct access

The control plane endpoint of a cluster MUST have both private and public access enabled.

Before the API server proxy runs, an operator MUST be able to reach the control plane endpoint from outside the cluster's VPC with an AWS IAM identity.

The control plane MUST accept EKS access entries as a source of authentication.

## Namespace tree

A cluster that hosts Tamanu deployments MUST have a namespace named `tamanu-super`, which is its [super namespace](../overview.md#super-namespace).

The super namespace MUST be a root of the namespace hierarchy.

Every [deployment namespace](../overview.md#deployment-namespace) MUST be a child of the super namespace.

The namespaces in the following table MUST NOT be descendants of the super namespace.

| namespace | holds |
|---|---|
| `tamanu-system` | The Secrets and config templates that deployments copy into their own namespaces. |
| `tamanu-seed` | The pgsnap operator and the seed jobs. |
| `tamanu-meta-` followed by a stack name | The instance of a [Canopy stack](../overview.md#canopy-stack), whose contents [K8SCNP](canopy.md) specifies. |

> [!NOTE]
> Propagation copies every binding of the super namespace into every descendant.
> A shared namespace placed in the tree would receive access meant for deployment namespaces.

Access to a namespace outside the tree MUST be granted by bindings created in that namespace.

## Deployment namespaces

A deployment namespace MUST be named `tamanu-` followed by the normalised stack name of its deployment, unless the deployment's configuration names it explicitly.

The normalised stack name MUST be derived from the stack name by the following steps, in order:

1. The stack name is lowercased.
2. Each run of characters other than `a` to `z`, `0` to `9` and `-` is replaced by one `-`.
3. Trailing `-` characters are removed.
4. The result is truncated to 56 characters.
5. Leading and trailing `-` characters are removed.

A deployment namespace MUST NOT have the name of a namespace in the table in [Namespace tree](#namespace-tree), or a name that begins `tamanu-meta-`.

A deployment namespace MUST exist before the objects of its deployment are applied.

A deployment namespace SHOULD be created as a subnamespace, by creating a SubnamespaceAnchor of the same name in the super namespace.

A deployment namespace that is created by any other means MUST have its parent set to the super namespace by a HierarchyConfiguration.

A stack that references a deployment namespace it did not create MUST leave the lifecycle of that namespace to its creator.

A deployment namespace that was created as a subnamespace MUST be deleted by deleting its anchor.

## Hierarchy controller

A cluster that has a super namespace MUST run HNC.

HNC MUST propagate Roles and RoleBindings.

HNC MUST NOT manage the namespaces `kube-system`, `kube-public` and `kube-node-lease`, or its own namespace.

The admission webhooks of HNC MUST run as at least two replicas, no two of which share an availability zone.

> [!NOTE]
> The webhooks validate every change to an object in every namespace that HNC manages, and they refuse the change when they cannot answer.
> With one replica, the loss of one node blocks all writes in every deployment namespace.

## Role propagation

A binding whose scope is the subtree of the super namespace MUST be created once, in the super namespace, and propagated to its descendants.

## Access groups

An [access group](../overview.md#access-group) MUST be a Kubernetes group whose name begins `tailscale:`.

A group assigned to a GitHub Actions workflow MUST be named `tailscale:gha:` followed by the purpose of the workflow.

| group | intended holders |
|---|---|
| `tailscale:oncall` | People on the on-call rota. |
| `tailscale:data-engineer` | Data engineers. |
| `tailscale:engineer` | Engineers who troubleshoot Tamanu deployments. |
| `tailscale:tamanu-engineer` | The same people as `tailscale:engineer`. |
| `tailscale:tamanu-deploy` | [Tamanu CD](../overview.md#tamanu-cd) and other automation that deploys Tamanu. |
| `tailscale:gha:dbt-build` | The dbt build workflow, which port-forwards to a database pod. |
| `tailscale:gha:renderer-promote` | The renderer promotion workflow, whose access [K8STRO](tamanu/renderer-rollout.md#access) defines. |
| `tailscale:gha:canopy` | The workflow that deploys Canopy, whose access [K8SCNP](canopy.md#access) describes. |

The bindings in the following table MUST exist.

| group | role | scope |
|---|---|---|
| `tailscale:oncall` | `oncall` | cluster-wide |
| `tailscale:data-engineer` | `data-engineer` | cluster-wide |
| `tailscale:engineer`, `tailscale:tamanu-engineer` | `tamanu-engineer` | the subtree of the super namespace, and `tamanu-system` |
| `tailscale:engineer`, `tailscale:tamanu-engineer` | `tamanu-engineer-cluster` | cluster-wide |
| `tailscale:engineer`, `tailscale:tamanu-engineer` | `view` | `metrics-system` |
| `tailscale:tamanu-deploy` | `tamanu-deploy` | the subtree of the super namespace, and `tamanu-seed` |
| `tailscale:tamanu-deploy` | `view` | the subtree of the super namespace, and `tamanu-seed` |
| `tailscale:tamanu-deploy` | `tamanu-deploy-system` | `tamanu-system` |
| `tailscale:tamanu-deploy` | `tamanu-deploy-cluster` | cluster-wide |
| `tailscale:tamanu-deploy` | `tamanu-deploy`, a Role over `applications` | the namespace of Argo CD |
| `tailscale:gha:renderer-promote` | `renderer-promote`, a Role over `applications` and the repo server Deployment | the namespace of Argo CD |
| `tailscale:gha:dbt-build` | `tamanu-gha-dbt-build` | the subtree of the super namespace |
| `tailscale:gha:canopy` | `cluster-admin` | the namespace of the Canopy stack, as [K8SCNP](canopy.md#instance) names it |
| `tailscale:gha:canopy` | `tamanu-meta-gha-canopy-ns` | cluster-wide |

An access group MUST NOT be bound to `cluster-admin` by a ClusterRoleBinding.

A binding of an access group to `cluster-admin` MUST be a RoleBinding.

## Roles

Each role MUST grant the permissions its purpose needs and no others.

The permissions of a role are defined once, in the stack that creates it, and are not restated here.
The bounds in the following table hold for every version of a role.

| role | purpose | bounds |
|---|---|---|
| `oncall` | Operating a cluster during an incident. | MAY change workloads, configuration, Secrets, database clusters, certificates and gateway resources. MUST NOT change Roles, RoleBindings or ClusterRoles. MUST NOT change nodes or namespaces. |
| `data-engineer` | Reading from a database through the cluster. | MUST NOT change any object. MAY open a port-forward or an exec session to a pod. |
| `tamanu-engineer` | Investigating a Tamanu deployment and applying small fixes. | MAY read most objects of a deployment, edit its ConfigMaps and Secrets, delete its pods, and update or patch its Deployments and StatefulSets. MUST NOT create or delete a workload. |
| `tamanu-engineer-cluster` | Cluster-wide read access that `tamanu-engineer` needs. | MUST be read-only. |
| `tamanu-deploy` | Creating and changing the objects of a Tamanu deployment in its namespace. | MUST be bound only in the namespaces of deployments. |
| `tamanu-deploy-cluster` | The cluster-scoped permissions that a deployment needs. | Limited to patching namespaces and managing VolumeSnapshotContents, as [Deployer limits](#deployer-limits) states. |
| `tamanu-deploy-system` | Letting the deployer read the shared configuration. | MUST be bound only in `tamanu-system`. MUST be read-only. |
| `tamanu-gha-dbt-build` | Letting the data build job reach a database. | MUST NOT change any object. |
| `renderer-promote` | Letting the renderer promotion workflow refresh Applications and restart the Argo CD repo server, as [K8STRO](tamanu/renderer-rollout.md#access) requires. | MUST be bound only in the namespace of Argo CD. MUST NOT be able to create or delete an Application. |
| `tamanu-meta-gha-canopy-ns` | Letting the Canopy deployment workflow create its own namespaces. | MUST NOT be able to change any object other than namespaces. |

The roles that can read Secrets MUST be `oncall`, `data-engineer`, `tamanu-engineer`, `tamanu-deploy` and `tamanu-deploy-system`, and the roles that `tamanu-gha-dbt-build` grants for reading the Secret of one database.

## Deployer limits

The [deployer](../overview.md#deployer) is the identity, in the access group `tailscale:tamanu-deploy`, that creates and changes the objects of a Tamanu deployment.

The deployer MUST NOT be able to create or delete a namespace.

The deployer MUST NOT hold a permission in a namespace other than the subtree of the super namespace, `tamanu-seed`, `tamanu-system` and the namespace of Argo CD.

The deployer MUST NOT hold a cluster-scoped permission other than those of the `tamanu-deploy-cluster` role.

The deployer SHOULD be able to patch only the namespaces of Tamanu deployments.

The deployer SHOULD be able to create, change and delete only the VolumeSnapshotContents of Tamanu deployments.

> [!NOTE]
> Role-based access control cannot limit a cluster-scoped permission to objects by name pattern.
> The deployer can therefore patch any namespace and manage any VolumeSnapshotContent in the cluster.

The deployer MUST NOT change the objects of `tamanu-system`.

The deployer MUST NOT hold the verbs `escalate` or `bind`.

The deployer MUST be able to create and release the claims of a workload, as [K8SVOL](volumes.md#provisioning-access) requires.

## Argo CD access

The Argo CD server MUST be reachable only through the tailnet.

The Argo CD server MUST have its built-in administrator account disabled.

A caller who reaches the Argo CD server MUST act with the default role.

The default role MUST allow a caller to manage the Applications of the `tamanu` AppProject, to read the logs of those Applications, to read that AppProject, and to create a Job from the suspended wake CronJob of such an Application.

The default role MUST NOT allow any other action.

> [!NOTE]
> The Argo CD controller can write anywhere in the cluster, and an engineer's own access is narrower.
> The actions a caller may ask the controller to apply are therefore limited by the AppProject and the role, whatever the cluster access of the caller.

The `tamanu` AppProject MUST accept only the repository `https://github.com/beyondessential/infra` as a source.

The `tamanu` AppProject MUST accept only destination namespaces of the cluster that runs Argo CD whose names match `tamanu-*`, other than those that begin `tamanu-meta-` and the shared namespaces `tamanu-super`, `tamanu-system` and `tamanu-seed`.

The `tamanu` AppProject MUST accept no cluster-scoped kind.

The `default` AppProject MUST accept no source, no destination and no cluster-scoped kind.

The deployer MUST be able to read and write Applications in the namespace of Argo CD, and MUST NOT hold any other permission there.
