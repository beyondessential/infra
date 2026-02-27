# Skill: Deploy to the Tinker Namespace

You are deploying experimental workloads to a shared Kubernetes cluster. All resources go in the `tinker` namespace.

## Prerequisites

### Install kubectl

```sh
# macOS
brew install kubectl

# Linux (amd64)
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/
```

### Configure kubeconfig

You must be connected to the Tailscale network. Write this to `~/.kube/config` (or merge it if the file already exists):

```yaml
apiVersion: v1
kind: Config
users:
- name: tailscale-auth
  user:
    token: unused
clusters:
- cluster:
    server: https://k8s-operator-tamanu-internal-main.tail53aef.ts.net
  name: k8s-operator-tamanu-internal-main.tail53aef.ts.net
contexts:
- context:
    cluster: k8s-operator-tamanu-internal-main.tail53aef.ts.net
    user: tailscale-auth
  name: main
current-context: main
```

Switch to the correct context (in case you have other clusters configured):

```sh
kubectl config use-context main
```

Verify connectivity:

```sh
kubectl cluster-info
```

### Check your permissions

Confirm you have the `tinkerer` role:

```sh
kubectl auth can-i create deployments -n tinker
kubectl auth can-i create pods -n tinker
```

Both should return `yes`. If not, request the `tinkerer` Tailscale group from Kamaka or Viti.

## Deploying

Create a single YAML file named `<nameofproject>.yaml` containing all the Kubernetes resources you need. Every resource must set `namespace: tinker` in its metadata.

Separate multiple resources with `---`.

Example structure:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myproject-config
  namespace: tinker
data:
  SOME_VAR: "some-value"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myproject
  namespace: tinker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myproject
  template:
    metadata:
      labels:
        app: myproject
    spec:
      containers:
      - name: myproject
        image: registry.example.com/myproject:latest
        envFrom:
        - configMapRef:
            name: myproject-config
---
apiVersion: v1
kind: Service
metadata:
  name: myproject
  namespace: tinker
spec:
  selector:
    app: myproject
  ports:
  - port: 80
    targetPort: 8080
```

Apply it:

```sh
kubectl apply -f myproject.yaml
```

Check status:

```sh
kubectl get pods -n tinker
kubectl logs -n tinker deployment/myproject
```

To update, edit the file and re-run `kubectl apply -f myproject.yaml`.

To access a service locally, use port-forwarding:

```sh
kubectl port-forward -n tinker svc/myproject 8080:80
```

### Exposing a service to the tailnet

You can make a Service reachable to anyone on the Tailscale network by adding annotations. Use the tags `tag:k8s,tag:tinker` and prefer to expose on port 80 for better UX —  Tailscale allows tinkerers access to all ports on tinker services.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myproject
  namespace: tinker
  annotations:
    tailscale.com/expose: "true"
    tailscale.com/tags: "tag:k8s,tag:tinker"
spec:
  selector:
    app: myproject
  ports:
  - port: 80
    targetPort: 8080
```

The Tailscale operator will create a proxy for the service. Tailscale automatically prepends the namespace name, so a Service called `myproject` in `tinker` will appear as `tinker-myproject` on the tailnet. Service names are unique within a namespace, so collisions are handled naturally.

### PostgreSQL

CNPG (CloudNativePG) is available. You can create a Postgres cluster as part of your YAML:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: myproject-db
  namespace: tinker
spec:
  instances: 1
  storage:
    size: 5Gi
```

Note: there are no database backups in this namespace. There is no IRSA role configured for `tinker`, so CNPG's backup-to-S3 functionality will not work. Treat all data as ephemeral.

## Restrictions

The `tinker` namespace has the following restrictions in place:

- **No Ingresses.** You cannot expose services to the internet. Use `kubectl port-forward` to access them locally.
- **No LoadBalancer or NodePort Services.** Only ClusterIP Services are allowed.
- **No TLS certificate issuance.** cert-manager is not available in this namespace.
- **No sub-namespace creation.** HNC SubnamespaceAnchors are not permitted.
- **No Tailscale resources.** You cannot create Tailscale CRs.
- **Storage is capped at 100Gi total** across all PVCs.
- **CNPG clusters are capped at 5.**

## Next steps

Once the experimental phase is finished:

- **To productivise:** Work with Kamaka to move your workload into a dedicated namespace with appropriate permissions, ingress, DNS, TLS, and monitoring. Do not run production workloads in `tinker`.
- **To tear down:** Delete your resources to free up storage and quota for other experiments:

```sh
kubectl delete -f myproject.yaml
```
