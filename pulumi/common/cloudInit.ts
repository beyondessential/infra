import { stringify as yamlStringify } from 'yaml';
import { EMERGENCY_SSH_KEY } from '../constants/internal.ts';

export function hostnameCommands(hostname: string): string[][] {
  return [['hostnamectl', 'set-hostname', hostname]];
}

export function tailscaleInstallCommands(): string[][] {
  return [['sh', '-c', 'curl -fsSL https://tailscale.com/install.sh | sh']];
}

export interface TailscaleUpOptions {
  authKey: string;
  hostname: string;
  advertiseTags?: string[];
  ssh?: boolean;
  operator?: string;
}

export function tailscaleUpCommands(options: TailscaleUpOptions): string[][] {
  const { authKey, hostname, advertiseTags, ssh = true, operator = 'ubuntu' } = options;

  const args = ['tailscale', 'up', `--auth-key=${authKey}`, `--hostname=${hostname}`];

  if (advertiseTags && advertiseTags.length > 0) {
    args.push(`--advertise-tags=${advertiseTags.join(',')}`);
  }

  if (ssh) {
    args.push('--ssh');
  }

  if (operator) {
    args.push(`--operator=${operator}`);
  }

  return [args, ['systemctl', 'enable', 'tailscaled']];
}

// spec: LNXSRV#provisioning
export function emergencySshKeyCommands(sshKey: string = EMERGENCY_SSH_KEY): string[][] {
  return [
    ['mkdir', '-p', '/home/ubuntu/.ssh'],
    ['sh', '-c', `echo ${sshKey} >> /home/ubuntu/.ssh/authorized_keys`],
  ];
}

export function cloudInitYaml(runcmd: string[][]): string {
  return `#cloud-config\n${JSON.stringify({ runcmd })}`;
}
