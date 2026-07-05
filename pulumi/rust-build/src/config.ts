import { cfg, region } from '../../common/k8s/coreRef.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';

// Stock public base image (per the "hub image + JIT install" preference — no
// bespoke image/build pipeline). Multi-arch, so each per-arch node pulls its own.
// The actual compiler is the image's rustup stable; extra targets + cross tools
// are installed just-in-time by setup.sh and cached on the volume.
export const image = cfg.get('image') ?? 'docker.io/library/rust:1-bookworm';

// Which arches to run builders for. Both by default: x86_64 for this laptop,
// arm64 native for Graviton colleagues.
export const architectures: Architecture[] =
  cfg.getObject<Architecture[]>('architectures') ?? ['amd64', 'arm64'];

// Short segment used in resource names (pools, leases, statefulsets) for each
// k8s/node arch label. Shared so names line up across the stack + wrapper.
export const archSeg: Record<Architecture, string> = { amd64: 'x86', arm64: 'arm' };

// Persistent per-arch cache volume (CARGO_HOME + sccache + per-repo source/target).
export const volumeSize = cfg.get('volumeSize') ?? '300Gi';

// Node ephemeral root disk (Bottlerocket data volume) for the build NodeClass:
// holds the container image + apt layers + /tmp. Real caches live on the PVC.
export const buildDiskGi = cfg.getNumber('buildDiskGi') ?? 150;

// Pod resource requests — sized to fill a 16 vCPU / 32 GiB node, leaving a little
// headroom for the daemonsets that ride every node.
export const cpuRequest = cfg.get('cpuRequest') ?? '14';
export const memoryRequest = cfg.get('memoryRequest') ?? '28Gi';

// Build-node instance floor + monthly price caps (USD) for the build pools.
export const nodeMinVcpu = cfg.getNumber('nodeMinVcpu') ?? 16;
export const nodeMinMemGi = cfg.getNumber('nodeMinMemGi') ?? 32;
export const spotMonthlyCap = cfg.getNumber('spotMonthlyCap') ?? 900;
export const ondemandMonthlyCap = cfg.getNumber('ondemandMonthlyCap') ?? 1500;

// How long an idle (empty) build node lingers before Karpenter reclaims it.
// Generous by design: while iterating, the node is reused for fast subsequent
// builds; it only shuts down after this window of no builds. The compile cache
// lives on the EBS PVC and survives reclaim regardless, so the cost of a cold
// node is provisioning latency, never recompilation.
export const consolidateAfter = cfg.get('consolidateAfter') ?? '1h';

// Max concurrent builders per arch (each = one warm slot with its own cache
// volume, one node). Bounds pool node count and hence cost, and is the number
// of slot Leases pre-created per arch.
export const maxBuilders = cfg.getNumber('maxBuilders') ?? 4;

// Tailscale group granted use of the builders (namespace-scoped Role). Dedicated
// to this tool, independent of oncall. The Tailscale ACL grant that puts users
// in this group is managed Tailscale-side (see README).
export const accessGroup = cfg.get('accessGroup') ?? 'tailscale:rust-build';

// Slot-lease liveness window (seconds). The wrapper renews within this; if a
// build's wrapper dies, the lease goes stale after this and another run can
// steal the slot.
export const leaseDurationSeconds = cfg.getNumber('leaseDurationSeconds') ?? 30;

export { region };
