# Runbook: Envoy Gateway will not deploy or crash-loops after a version bump

A `k8s-essentials` run stops with "Envoy Gateway ... needs Gateway API ..., but this cluster has ...", or the `envoy-gateway` Helm release times out with the controller crash-looping.
The controller expects Gateway API and Envoy CRDs that the cluster does not have yet.
Versions: [k8s-component-versions](../reference/k8s-component-versions.md).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

Helm installs a chart's `crds/` directory once and never upgrades it, so a controller bump runs against the CRDs the cluster was built with.
The stack installs the CRDs from a separate chart (`gateway-crds`) so they do upgrade, but its preflight `failIfGatewayApiTooOld()` refuses to deploy a controller whose Gateway API bundle is older than the pin (`pulumi/k8s-essentials/envoyGateway.ts`).
An apply rejected with "ClientTrafficPolicy must set spec.http3" or "must not set spec.enableProxyProtocol" is the admission policy, not a version problem: the last row of the table.

## 2. Establish context

Which cluster, which versions were raised in `pulumi/k8s-essentials/versions.ts`, and whether the run was a preflight refusal or a Helm timeout. **[diagnose]**

## 3. Investigate

```
kubectl --context=<context> get crd gateways.gateway.networking.k8s.io -o jsonpath='{.metadata.annotations.gateway\.networking\.k8s\.io/bundle-version}'
kubectl --context=<context> -n envoy-gateway-system get pods
kubectl --context=<context> -n envoy-gateway-system logs -l app.kubernetes.io/name=envoy-gateway --tail=50
```

**[diagnose]** Compare the bundle version with `GATEWAY_API_VERSION` in `pulumi/k8s-essentials/versions.ts`.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| The run stops at "needs Gateway API ..., but this cluster has ..." | The preflight found the installed bundle older than the pin. | Apply the bundle (section 5). |
| Bundle older than the pin; controller log shows a missing kind | Envoy Gateway 1.8 watches `ListenerSet`, which arrived in Gateway API 1.5. | Apply the bundle (section 5). |
| Controller log: `ClientTrafficPolicy` rejects `clientValidation.mode` as "not declared in schema" | The installed CRDs are older than the controller. | Apply the bundle (section 5). |
| Bundle matches the pin, controller still crash-loops | Not a CRD mismatch. | Escalate (section 6). |
| Apply rejected with "ClientTrafficPolicy must set spec.http3" or "must not set spec.enableProxyProtocol" | The admission policy doing its job: with merged gateways, one policy without HTTP/3 silently breaks HTTP/3 for every gateway, and the PROXY protocol breaks QUIC ([K8SING](../spec/kubernetes/ingress.md#envoy-proxy)). | Fix the policy in the stack that declares it. **[dev-OTS]** |

## 5. Resolve

Apply the bundle named in the error, then re-run the stack. **[dev-OTS]**

```
kubectl apply --server-side --force-conflicts -f \
  https://github.com/kubernetes-sigs/gateway-api/releases/download/<GATEWAY_API_VERSION>/experimental-install.yaml
pulumi up --policy-pack ../policies     # in pulumi/k8s-essentials, over the tailnet
```

Upgrade the CRDs before raising either version.
The second command of section 3 shows the controller pods Running once the run completes. **[diagnose]**

## 6. Escalate

State is **fix-required** if the preflight passes and the controller still crash-loops: code area `pulumi/k8s-essentials/envoyGateway.ts`.
Include the cluster, the controller log lines and the installed bundle version.
