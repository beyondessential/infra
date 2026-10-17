# SOP: Connect to a deployment's database from the cluster

Open a `psql` session on the central or a facility database of a Kubernetes deployment.
Finding the pod is **[diagnose]**.
The session is **[diagnose, sensitive-data]** for reads: everything on screen is patient or test data, and this route has no redaction, unlike `bestool tamanu psql`.
A mutating statement takes its class from the statement, and the Tamanu pack's [ruled-out list](https://github.com/beyondessential/tamanu/blob/main/docs/ruled-out-actions.md) and [ours](../ruled-out-actions.md#ruled-out-actions-never-suggest) apply.
The Tamanu pack's [connect-psql](https://github.com/beyondessential/tamanu/blob/main/docs/sops/connect-psql.md) has the same route and the `bestool` syntax for hosts.

Each server has its own database cluster, `central-db` or `facility-N-db`, and the Tamanu database in it is `app`.

## Through the primary pod

1. Find the primary.
   Do not assume an ordinal:

   ```sh
   kubectl -n tamanu-<stack> get pods -l cnpg.io/cluster=central-db,cnpg.io/instanceRole=primary
   ```

2. Open `psql` in it, naming the database, then make the session read-only before anything else:

   ```sh
   kubectl -n tamanu-<stack> exec -it <primary-pod> -- psql -U postgres app
   ```

   ```sql
   SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
   ```

`-U postgres` is the superuser, so the read-only setting is the only guard.
The roles that can do this are `tamanu-engineer` and `data-engineer` (`pods/exec`), and on-call ([K8SNSP](../spec/kubernetes/namespaces.md#roles)).

## Over the tailnet (central only)

With `dbExpose` on (the default) the central primary is reachable on port 5432 at the tailnet host `k8s-pg-<stack>`, through the Service `central-db-tailscale`.
The credentials are those of the `app` role in the Secret `central-db-app`, whose `uri` key holds the connection string.
Reading that Secret is **[diagnose, sensitive-data]**: do not print it into a shared terminal or paste it anywhere.
Facility databases are not exposed this way.

## Credentials in the cluster

The servers connect with the `uri` of `<server>-db-app`, and the `*-reporting-grants` Job uses `<server>-db-superuser` ([object names](../reference/tamanu-deployment-objects.md#created-by-cloudnativepg)).
Never recreate those Secrets.
