# Skill: Deploy to the Tinker Namespace (with Gateway)

You are deploying experimental workloads to a shared Kubernetes cluster and optionally exposing them to the public internet via the Tinker Gateway. All resources go in the `tinker` namespace.

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

### Tailscale

You must be connected to the Tailscale network for:
- kubectl access to the cluster
- The Tinker Gateway management API (authenticated via Tailscale identity)

Verify you are connected:

```sh
tailscale status
```

## Deploying a Workload

Create a single YAML file named `<project>.yaml` containing your Kubernetes resources. Every resource must set `namespace: tinker` in its metadata. Separate multiple resources with `---`.

Minimal example with a Deployment and Service:

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

To access a service locally without exposing it, use port-forwarding:

```sh
kubectl port-forward -n tinker svc/myapp 8080:80
```

## Exposing via the Tinker Gateway (Public Internet)

To give your Service a public URL via the Tinker Gateway, add the `tinker.bes.au/expose` annotation to the **Service** resource:

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

Optionally set a custom subdomain name with `tinker.bes.au/name`. If omitted, the Service name is used:

```yaml
  annotations:
    tinker.bes.au/expose: "true"
    tinker.bes.au/name: "my-custom-name"
```

Apply the change:

```sh
kubectl apply -f myapp.yaml
```

The gateway controller watches for these annotations, registers the service, and writes back:
- `tinker.bes.au/tinker-id` — the assigned Tinker ID (a UUID)
- `tinker.bes.au/public-hostname` — the public URL (e.g. `myapp.tinker.bes.au`)

If there is a name conflict, `tinker.bes.au/error: name-conflict` is set instead. Choose a different name and re-apply.

## Retrieving the Public URL

### Option 1: Read the annotation from the Service

Wait a few seconds after applying, then:

```sh
kubectl get svc myapp -n tinker -o jsonpath='{.metadata.annotations.tinker\.bes\.au/public-hostname}'
```

This returns something like `myapp.tinker.bes.au`. The full URL is `https://myapp.tinker.bes.au`.

To also check for errors:

```sh
kubectl get svc myapp -n tinker -o jsonpath='{.metadata.annotations.tinker\.bes\.au/error}'
```

### Option 2: Use the Management API

Look up the app by name (requires Tailscale authentication):

```sh
curl -s https://tinker.bes.au/api/manage/apps/myapp | jq .
```

Response:

```json
{
  "tinker_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tinker_name": "myapp",
  "public_hostname": "myapp.tinker.bes.au",
  "backend_address": "http://myapp.tinker.svc.cluster.local:80",
  "public": true,
  "request_count": 0,
  "last_seen_at": null
}
```

## Managing Apps via the Management API

All management API endpoints require Tailscale authentication. The base URL is `https://tinker.bes.au`.

### List all apps

```sh
curl -s https://tinker.bes.au/api/manage/apps | jq .
```

### Look up an app by name

```sh
curl -s https://tinker.bes.au/api/manage/apps/myapp | jq .
```

### Toggle public availability

Toggle whether the app is publicly accessible (flips the `public` boolean). Uses the Tinker ID (UUID), not the name:

```sh
curl -s -X POST https://tinker.bes.au/api/manage/apps/<tinker_id>/public | jq .
```

Response:

```json
{
  "tinker_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "public": false
}
```

### Get stats

```sh
curl -s https://tinker.bes.au/api/manage/apps/<tinker_id>/stats | jq .
```

Response:

```json
{
  "tinker_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "request_count": 42,
  "last_seen_at": "2025-01-15T10:30:00Z"
}
```

### Disconnect an app

Remove the registration from the gateway entirely. Uses the Tinker ID:

```sh
curl -s -X DELETE https://tinker.bes.au/api/manage/apps/<tinker_id>
```

Returns 204 No Content on success, 404 if not found.

Note: this only removes the gateway registration. The Service and its annotations still exist in Kubernetes. If the `tinker.bes.au/expose: "true"` annotation is still present, the controller will re-register the service on its next reconciliation loop (~5 minutes). To permanently disconnect, remove the expose annotation from the Service first.

## Tailscale-Only Ingress (Not Public)

If you want your service reachable only on the Tailscale network (not the public internet), use a Tailscale Ingress instead of the gateway annotations. All ingress hostnames must be prefixed with `tinker-`.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp
  namespace: tinker
  annotations:
    tailscale.com/tags: "tag:k8s,tag:tinker"
spec:
  ingressClassName: tailscale
  rules:
  - host: tinker-myapp
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp
            port:
              number: 80
  tls:
  - hosts:
    - tinker-myapp
```

Only `ingressClassName: tailscale` is allowed in this namespace; other ingress classes will be rejected.

Once the Ingress is ready, look up its URL:

```sh
kubectl get ingress myapp -n tinker -o jsonpath='https://{.status.loadBalancer.ingress[0].hostname}'
```

For non-HTTP services (raw TCP), expose via Tailscale annotations on the Service instead:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: tinker
  annotations:
    tailscale.com/expose: "true"
    tailscale.com/tags: "tag:k8s,tag:tinker"
spec:
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
```

The service appears as `tinker-myapp` on the tailnet.

## PostgreSQL via CNPG

CNPG (CloudNativePG) is available. You can create a Postgres cluster as part of your YAML:

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

There are no database backups in this namespace. There is no IRSA role configured for `tinker`, so CNPG's backup-to-S3 functionality will not work. Treat all data as ephemeral.

To connect from your app, CNPG creates a secret named `<cluster>-app` with connection details:

```yaml
env:
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: myapp-db-app
      key: uri
```

## Restrictions

The `tinker` namespace has the following restrictions:

- **Tailscale ingresses only.** You can create Ingress resources, but only with `ingressClassName: tailscale`. Internet-facing ingress classes (e.g. `nginx`) are blocked. All ingress hostnames must start with `tinker-`.
- **No LoadBalancer or NodePort Services.** Only ClusterIP Services are allowed.
- **No TLS certificate issuance.** cert-manager is not available in this namespace.
- **No sub-namespace creation.** HNC SubnamespaceAnchors are not permitted.
- **No Tailscale resources.** You cannot create Tailscale CRs directly.
- **Storage is capped at 100Gi total** across all PVCs.
- **CNPG clusters are capped at 5.**
- **Public exposure** is only available through the Tinker Gateway annotations (`tinker.bes.au/expose`), not through traditional ingress controllers.

## Teardown

To remove your workload and free up resources:

```sh
kubectl delete -f myapp.yaml
```

If the Service had `tinker.bes.au/expose: "true"`, deleting the Service triggers the controller to deregister it from the gateway automatically. No manual cleanup of the gateway registration is needed.

To verify the gateway registration was removed:

```sh
curl -s https://tinker.bes.au/api/manage/apps/myapp
```

This should return 404.