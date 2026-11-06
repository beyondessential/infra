import { stringify as yamlStringify } from 'yaml';

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

// spec: LNXAWS#first-boot
export function ssmAgentInstallCommands(): string[][] {
  return [
    ['snap', 'wait', 'system', 'seed.loaded'],
    ['sh', '-c', 'snap list amazon-ssm-agent || snap install amazon-ssm-agent --classic'],
    ['systemctl', 'enable', '--now', 'snap.amazon-ssm-agent.amazon-ssm-agent.service'],
  ];
}

export function cloudInitYaml(runcmd: string[][]): string {
  return `#cloud-config\n${JSON.stringify({ runcmd })}`;
}
