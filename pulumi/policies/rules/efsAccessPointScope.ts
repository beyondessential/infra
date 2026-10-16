import type { StackValidationPolicy } from '@pulumi/policy';
import * as k8s from '@pulumi/kubernetes';

const EFS_DRIVER = 'efs.csi.aws.com';
const CLAIM_NAME_TOKEN = '.PVC.name';

// A handle names an access point as `fs-<id>::fsap-<id>`; without the second
// half it addresses the filesystem root.
const ACCESS_POINT_HANDLE = /^fs-[0-9a-f]+::fsap-[0-9a-f]+$/;

function segments(pattern: string): string[] {
  return pattern.split('/').filter((segment) => segment.length > 0);
}

// spec: K8SVOL#isolation
export const efsAccessPointScoped: StackValidationPolicy = {
  name: 'efs-access-point-scoped',
  description:
    'EFS volumes must be confined to a directory of their own. A storage class must provision through access points on a per-claim subpath, and a PersistentVolume must name an access point rather than the filesystem root. Releasing a claim can delete whatever its access point is rooted at, so a shared or absent subpath puts another claim\'s content in reach.',
  enforcementLevel: 'mandatory',
  validateStack: (args, reportViolation) => {
    for (const resource of args.resources) {
      const storageClass = resource.asType(k8s.storage.v1.StorageClass) as any;
      if (storageClass?.provisioner === EFS_DRIVER) {
        const parameters = storageClass.parameters ?? {};

        if (parameters.provisioningMode !== 'efs-ap') {
          reportViolation(
            `EFS StorageClass sets provisioningMode '${parameters.provisioningMode ?? '(unset)'}'; only 'efs-ap' confines a claim to its own directory.`,
            resource.urn,
          );
        }

        const subPathPattern: string | undefined = parameters.subPathPattern;
        if (!subPathPattern) {
          reportViolation(
            'EFS StorageClass sets no subPathPattern, so its access points are rooted at the filesystem root.',
            resource.urn,
          );
        } else {
          if (segments(subPathPattern).length < 2) {
            reportViolation(
              `EFS StorageClass subPathPattern '${subPathPattern}' is shallower than two segments, so claims share a directory close to the filesystem root.`,
              resource.urn,
            );
          }
          if (!subPathPattern.includes(CLAIM_NAME_TOKEN)) {
            reportViolation(
              `EFS StorageClass subPathPattern '${subPathPattern}' does not vary by ${CLAIM_NAME_TOKEN}, so two claims share one directory and releasing either takes the other's content.`,
              resource.urn,
            );
          }
        }

        if (parameters.ensureUniqueDirectory !== 'true') {
          reportViolation(
            "EFS StorageClass does not set ensureUniqueDirectory = 'true', so a rebuilt claim adopts the directory its predecessor left and can release content still held elsewhere.",
            resource.urn,
          );
        }
      }

      const volume = resource.asType(k8s.core.v1.PersistentVolume) as any;
      if (volume?.spec?.csi?.driver === EFS_DRIVER) {
        const handle: string = volume.spec.csi.volumeHandle ?? '';
        if (!ACCESS_POINT_HANDLE.test(handle)) {
          reportViolation(
            `EFS PersistentVolume has volumeHandle '${handle || '(unset)'}', which names no access point and so reaches the whole filesystem.`,
            resource.urn,
          );
        }
      }
    }
  },
};
