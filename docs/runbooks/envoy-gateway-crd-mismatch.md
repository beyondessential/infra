# Runbook: Envoy Gateway will not deploy or crash-loops after a version bump

A `k8s-essentials` run stops with "Envoy Gateway ... needs Gateway API ..., but this cluster has ...", or the `envoy-gateway` Helm release times out with the controller crash-looping.
The controller expects Gateway API and Envoy CRDs that the cluster does not have yet.
Versions: [k8s-component-versions](../reference/k8s-component-versions.md).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.

## 1. Confirm

```
kubectl --context=<context> get crd gateways.gateway.networking.k8s.io -o jsonpath='{.metadata.annotations.gateway\.networking\.k8s\.io/bundle-version}'
kubectl --context=<context> -n envoy-gateway-system get pods
kubectl --context=<context> -n envoy-gateway-system logs -l app.kubernetes.io/name=envoy-gateway --tail=50
```

**[diagnose]** Compare the bundle version with `GATEWAY_API_VERSION` in `pulumi/k8s-essentials/versions.ts`.
In the log, the signatures are a missing kind (Envoy Gateway 1.8 watches `ListenerSet`, which arrived in Gateway API 1.5) or `ClientTrafficPolicy` rejecting `clientValidation.mode` as "not declared in schema".

## 2. Interpret

Helm installs a chart's `crds/` directory once and never upgrades it, so a controller bump runs against the CRDs the cluster was built with.
The stack installs the CRDs from a separate chart (`gateway-crds`) so they do upgrade, but its preflight `failIfGatewayApiTooOld()` refuses to deploy a controller whose Gateway API bundle is older than the pin.

## 3. Resolve

Apply the bundle named in the error, then re-run the stack. **[dev-OTS]**

```
kubectl apply --server-side --force-conflicts -f \
  https://github.com/kubernetes-sigs/gateway-api/releases/download/<GATEWAY_API_VERSION>/experimental-install.yaml
pulumi up --policy-pack ../policies     # in pulumi/k8s-essentials, over the tailnet
```

Upgrade the CRDs before raising either version.

## A different Envoy error

An apply rejected with "ClientTrafficPolicy must set spec.http3", or "must not set spec.enableProxyProtocol", is the admission policy doing its job, not a version problem: with merged gateways, one policy without HTTP/3 silently breaks HTTP/3 for every gateway, and the PROXY protocol breaks QUIC ([K8SING](../spec/kubernetes/ingress.md#envoy-proxy)).
Fix the policy in the stack that declares it. **[dev-OTS]**

## Escalate

State is **fix-required** if the preflight passes and the controller still crash-loops: code area `pulumi/k8s-essentials/envoyGateway.ts`.
Include the controller log lines and the installed bundle version.
