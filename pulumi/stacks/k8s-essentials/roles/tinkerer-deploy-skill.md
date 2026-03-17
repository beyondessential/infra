# Skill: Deploy to the Tinker Namespace

You are deploying experimental workloads to a shared Kubernetes cluster. All resources go in the `tinker` namespace.

> **Important:** Manage all tinker resources exclusively via `kubectl` and Kubernetes manifests. The Tinker Gateway management API and dashboard at `tinker.bes.au` use browser-based Tailscale authentication that cannot be used from scripts or agents. Do not attempt to call those endpoints directly.

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

Switch to the correct context:

```sh
kubectl config use-context main
kubectl cluster-info
```

### Check your permissions

```sh
kubectl auth can-i create deployments -n tinker
kubectl auth can-i create pods -n tinker
```

Both should return `yes`. If not, request the `tinkerer` Tailscale group from Kamaka or Viti.

### Tailscale

You must be connected to the Tailscale network for kubectl access to the cluster.

```sh
tailscale status
```

## Deploying a Workload

Create a single YAML file named `<project>.yaml`. Every resource must set `namespace: tinker`. Separate multiple resources with `---`.

Minimal example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: tinker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: registry.example.com/myapp:latest
        ports:
        - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: tinker
spec:
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
```

Apply it:

```sh
kubectl apply -f myapp.yaml
```

Check status:

```sh
kubectl get pods -n tinker -l app=myapp
kubectl logs -n tinker deployment/myapp
```

To update, edit the file and re-run `kubectl apply -f myapp.yaml`.

To access a service locally without exposing it:

```sh
kubectl port-forward -n tinker svc/myapp 8080:80
```

## Exposing an HTTP UI via the Tinker Gateway

The Tinker Gateway is the primary way to expose HTTP workloads. It gives your service a public URL at `<name>.tinker.bes.au` and authenticates visitors using their Tailscale identity by default, so only people on the tailnet can access it unless you explicitly make it public.

Add the `tinker.bes.au/expose` annotation to the **Service**:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: tinker
  annotations:
    tinker.bes.au/expose: "true"
spec:
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
```

Optionally set a custom subdomain with `tinker.bes.au/name`. If omitted, the Service name is used:

```yaml
  annotations:
    tinker.bes.au/expose: "true"
    tinker.bes.au/name: "my-custom-name"
```

Apply:

```sh
kubectl apply -f myapp.yaml
```

The gateway controller registers the service and writes back:
- `tinker.bes.au/tinker-id` — the assigned Tinker ID (UUID)
- `tinker.bes.au/public-hostname` — the public URL (e.g. `myapp.tinker.bes.au`)

Wait a few seconds, then retrieve the URL:

```sh
kubectl get svc myapp -n tinker -o jsonpath='{.metadata.annotations.tinker\.bes\.au/public-hostname}'
```

The full URL is `https://<hostname>`.

To check for errors:

```sh
kubectl get svc myapp -n tinker -o jsonpath='{.metadata.annotations.tinker\.bes\.au/error}'
```

If this returns `name-conflict`, another Service already holds that name. Set a different `tinker.bes.au/name` and re-apply.

## Exposing Non-HTTP Services via Tailscale

For services that are not HTTP UIs — raw TCP, databases, internal APIs, etc. — expose them directly onto the Tailscale network using the `tailscale.com/expose` annotation on the Service. The service will appear as `tinker-<name>` on the tailnet and is accessible only to tailnet members.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mydb
  namespace: tinker
  annotations:
    tailscale.com/expose: "true"
    tailscale.com/tags: "tag:k8s,tag:tinker"
spec:
  selector:
    app: mydb
  ports:
  - port: 5432
    targetPort: 5432
```

The service appears as `tinker-mydb` on the tailnet. Connect to it directly using that hostname.

Do not use this approach for HTTP UIs — use the Tinker Gateway instead.

## PostgreSQL via CNPG

CNPG (CloudNativePG) is available:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: myapp-db
  namespace: tinker
spec:
  instances: 1
  storage:
    size: 5Gi
```

There are no database backups in this namespace and no IRSA role configured, so CNPG's backup-to-S3 will not work. Treat all data as ephemeral.

CNPG creates a secret named `<cluster>-app` with connection details:

```yaml
env:
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: myapp-db-app
      key: uri
```

To expose the database directly to the tailnet for external access, use the Tailscale Service annotation described above.

## Restrictions

- **No LoadBalancer or NodePort Services.** Only ClusterIP Services are allowed.
- **No TLS certificate issuance.** cert-manager is not available in this namespace.
- **No sub-namespace creation.** HNC SubnamespaceAnchors are not permitted.
- **Storage is capped at 100Gi total** across all PVCs.
- **CNPG clusters are capped at 5.**
- **HTTP exposure** goes through the Tinker Gateway (`tinker.bes.au/expose`). There is no traditional ingress controller available in this namespace.
- **Non-HTTP exposure** goes through the Tailscale Service annotation (`tailscale.com/expose`). This is Tailscale-network-only.

## Teardown

```sh
kubectl delete -f myapp.yaml
```

If the Service had `tinker.bes.au/expose: "true"`, deleting it triggers the controller to deregister it from the gateway automatically. No manual cleanup is needed.

To verify deregistration (if the Service still exists but the annotation was removed):

```sh
kubectl get svc myapp -n tinker -o jsonpath='{.metadata.annotations.tinker\.bes\.au/tinker-id}' 2>/dev/null || echo "deregistered"
```

If the Service itself was deleted, this will simply return nothing.