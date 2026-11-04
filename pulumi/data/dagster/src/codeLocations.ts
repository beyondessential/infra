import { codeLocations, cpuRequest, imageRepository, imageTag, memoryRequest } from './config.ts';
import { envSecretName } from './secrets.ts';

// spec: DAGS#code-locations
function codeServer(loc: (typeof codeLocations)[number]) {
  if (!loc.file === !loc.package) {
    throw new Error(
      `codeLocations entry needs exactly one of file and package: ${JSON.stringify(loc)}`,
    );
  }
  // DNS-1035 safe, as it names Kubernetes objects; the Python name may not be.
  const name = (loc.file?.replace(/\.py$/, '') ?? loc.package!).replace(/_/g, '-');
  const args = loc.file ? ['--python-file', loc.file] : ['--package-name', loc.package!];
  return {
    name,
    image: { repository: imageRepository, tag: imageTag, pullPolicy: 'Always' },
    codeServerArgs: args,
    port: 3030,
    envSecrets: [{ name: envSecretName }],
    resources: {
      requests: { cpu: cpuRequest, memory: loc.memoryRequest ?? memoryRequest },
    },
  };
}

export const userDeploymentsValues = codeLocations.map(codeServer);

const names = userDeploymentsValues.map((d) => d.name);
const duplicate = names.find((n, i) => names.indexOf(n) !== i);
if (duplicate) {
  throw new Error(`codeLocations has two entries named ${duplicate}`);
}
