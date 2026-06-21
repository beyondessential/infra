export const AWS_ORG_ID = 'o-asiuh5s5mc';
export const AWS_ROOT_ID = 'r-veli';

/// https://github.com/beyondessential/linux-images
// ubuntu-26.04-bes-cloud-amd64-2026.06.22
export const AMI_UBUNTU_AMD64 = {
  'ap-south-1': 'ami-0ecef1af1c0175fe0',
  'ap-southeast-2': 'ami-0ea2572f63fa77beb',
  'ap-southeast-6': 'ami-0c7361d476e12d782',
  'eu-central-2': 'ami-0cbd5d7b036fa2c11',
  'us-east-1': 'ami-0307c784b1e6bf3c9',
};
// ubuntu-26.04-bes-cloud-arm64-2026.06.22
export const AMI_UBUNTU_ARM64 = {
  'ap-south-1': '',
  'ap-southeast-2': 'ami-00bfcf242f06f333d',
  'ap-southeast-6': 'ami-08da651447038ba6d',
  'eu-central-2': '',
  'us-east-1': '',
};

export const AWS_TAMANU_INTERNAL_CERTBOT_POLICY = 'arn:aws:iam::143295493206:policy/CertbotRenewal';

export const TAILNET_ID = 'TZAJWRvY3B11CNTRL';
export const TAILNET_DOMAIN = 'tail53aef.ts.net';

export const LOGS_BUCKETS = {
  TAMANU: 'bes-tamanu-logs',
  DATA: 'bes-data-logs',
  TUPAIA: 'bes-tupaia-logs',
};

export const EMERGENCY_SSH_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOpCpG0MNsBX6nNbq4jMMJwbw5c4PbuH1xBfDeNq8d0u emergency@tamanu';

export const DEFAULT_POSTGRES_VERSION = 17;

export const GATEWAY_CLASS_ENVOY = 'envoy-gateway';
