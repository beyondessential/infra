# RBAC Rollout Plan for Tamanu K8s

This document outlines the manual steps required to complete the RBAC rollout
for restrictive permissions on the Tamanu Kubernetes cluster.

## Overview

The new RBAC setup provides least-privilege access:

| Role | Group | Scope | Purpose |
|------|-------|-------|---------|
| `oncall` | `tailscale:oncall` | Cluster-wide | Broad troubleshooting access |
| `data-engineer` | `tailscale:data-engineer` | Cluster-wide | Postgres database access |
| `tamanu-deploy` | `tailscale:tamanu-deploy` | tamanu-* namespaces | GitHub Actions machine deploy |
| `tamanu-engineer` | `tailscale:tamanu-engineer` | tamanu-* namespaces | Tamanu team access |

## Step 1: Apply Pulumi Changes

Apply in order:

```sh
# 1. Cluster-wide roles (oncall, data-engineer)
cd pulumi/stacks/k8s-essentials
pulumi up

# 2. Tamanu-specific roles
cd pulumi/stacks/tamanu/k8s-infra
pulumi up
```

## Step 2: Update Tailscale Policy

Add the following to your Tailscale ACL policy to map tags/groups to Kubernetes groups.

### Machine Deploy (GitHub Actions)

Replace existing `system:masters` grant for deploy with restrictive permissions:

```jsonc
{
  "src": ["tag:infra-gha-deploy"],
  "dst": ["tag:k8s-operator"],
  "app": {
    "tailscale.com/cap/kubernetes": [
      {
        "impersonate": {
          "groups": ["tailscale:tamanu-deploy"]
        }
      }
    ]
  }
}
```

### Human Access Groups

Add mappings for human users. Adjust `src` to match your Tailscale groups:

```jsonc
// Oncall staff
{
  "src": ["group:oncall"],
  "dst": ["tag:k8s-operator"],
  "app": {
    "tailscale.com/cap/kubernetes": [
      {
        "impersonate": {
          "groups": ["tailscale:oncall"]
        }
      }
    ]
  }
},

// Tamanu engineers/testers
{
  "src": ["group:tamanu-team"],
  "dst": ["tag:k8s-operator"],
  "app": {
    "tailscale.com/cap/kubernetes": [
      {
        "impersonate": {
          "groups": ["tailscale:tamanu-engineer"]
        }
      }
    ]
  }
},

// Data engineers
{
  "src": ["group:data-team"],
  "dst": ["tag:k8s-operator"],
  "app": {
    "tailscale.com/cap/kubernetes": [
      {
        "impersonate": {
          "groups": ["tailscale:data-engineer"]
        }
      }
    ]
  }
},

// Cluster admins (keep existing system:masters)
{
  "src": ["group:infra-admins"],
  "dst": ["tag:k8s-operator"],
  "app": {
    "tailscale.com/cap/kubernetes": [
      {
        "impersonate": {
          "groups": ["system:masters"]
        }
      }
    ]
  }
}
```

## Step 3: Update GitHub Action (cd-up.yml)

Update the Tamanu repo's `.github/workflows/cd-up.yml` to use SubnamespaceAnchors
for namespace lifecycle management.

### Replace namespace creation step

```yaml
- name: Create or check namespace
  run: |
    NS_NAME="tamanu-${{ inputs.deploy-name }}"
    
    # Check if subnamespace anchor exists
    if kubectl -n tamanu-super get subnamespaceanchor "$NS_NAME" 2>/dev/null; then
      echo "Namespace exists, checking it's matched to this branch"
      kubectl -n "$NS_NAME" \
        get configmap auto-deploy -o json \
        | tee -a /dev/stderr \
        | jq -e '.data | [.repo == "${{ github.repository }}", .ref == "${{ inputs.ref }}"] | all'
    else
      # Create SubnamespaceAnchor - HNC will create the namespace
      kubectl apply -f - <<EOF
    apiVersion: hnc.x-k8s.io/v1alpha2
    kind: SubnamespaceAnchor
    metadata:
      name: $NS_NAME
      namespace: tamanu-super
    EOF
      
      # Wait for namespace to be created by HNC
      kubectl wait --for=condition=Ready subnamespaceanchor/"$NS_NAME" \
        -n tamanu-super --timeout=30s || true
      
      # Create tracking configmap
      kubectl -n "$NS_NAME" \
        create configmap auto-deploy \
        --from-literal=repo=${{ github.repository }} \
        --from-literal=ref=${{ inputs.ref }}
    fi

    kubectl -n "$NS_NAME" \
      patch configmap auto-deploy \
      -p '{"data":{"control":"${{ inputs.control }}"}}'

    kubectl -n "$NS_NAME" \
      patch configmap auto-deploy \
      -p '{"data":{"imageTag":"${{ inputs.image-tag }}"}}'
```

### Add Pulumi config for external namespace

Update the Pulumi config step to include `externalNamespace: true`:

```yaml
- name: Generate pulumi config
  id: config
  uses: actions/github-script@v7
  with:
    script: |
      const cwd = '${{ github.workspace }}';
      const { configMap } = await import(`${cwd}/packages/scripts/src/ghaCdHelpers.mjs`);
      const config = configMap('${{ inputs.deploy-name }}', '${{ inputs.image-tag }}', ${{ inputs.options }});
      // Add externalNamespace flag
      config['externalNamespace'] = { value: 'true' };
      core.setOutput('pulumi', JSON.stringify(config));
```

### Create teardown workflow (cd-down.yml)

```yaml
name: CD Down

on:
  workflow_call:
    inputs:
      deploy-name:
        type: string
        required: true
      # ... other inputs
    secrets:
      TAILSCALE_OAUTH:
        required: true

jobs:
  teardown:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-cd
        with:
          tailscale-oauth: ${{ secrets.TAILSCALE_OAUTH }}
          k8s-core: ${{ fromJson(inputs.options).k8score }}

      - name: Delete namespace via SubnamespaceAnchor
        run: |
          kubectl -n tamanu-super delete subnamespaceanchor tamanu-${{ inputs.deploy-name }} --wait=true
```

## Verification

After completing the rollout:

1. **Test GitHub Actions deploy**: Trigger a PR deploy and verify it succeeds
2. **Test GitHub Actions teardown**: Close a PR and verify namespace is deleted
3. **Test engineer access**: Have a tamanu-engineer try to:
   - View pods in tamanu namespaces ✓
   - Edit a configmap ✓
   - Restart a deployment ✓
   - Access a non-tamanu namespace ✗ (should fail)
4. **Test data-engineer access**: Verify port-forward to postgres works
5. **Test oncall access**: Verify broad access across namespaces

## Rollback

If issues occur, revert the Tailscale policy to grant `system:masters` to
`tag:infra-gha-deploy` while troubleshooting.