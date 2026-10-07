export const AWS_ORG_ID = 'o-asiuh5s5mc';
export const AWS_ROOT_ID = 'r-veli';
export const AWS_PRIMARY_ACCOUNT_ID = '295280690919';

// Tupaia predates `core` and intentionally uses its default VPC, so it is
// exempt from default-VPC cleanup and the create-default-VPC deny SCP.
export const AWS_TUPAIA_ACCOUNT_ID = '843218180240';

/// https://github.com/beyondessential/linux-images
// ubuntu-26.04-bes-cloud-amd64-2026.10.01
export const AMI_UBUNTU_AMD64 = {
  'ap-south-1': 'ami-0cced5ec9239697f9',
  'ap-southeast-2': 'ami-0781516577d850d53',
  'ap-southeast-6': 'ami-04fd3243f362aec9d',
  'eu-central-2': 'ami-0f9aa709632b01874',
  'us-east-1': 'ami-05b6de37098e3e458',
};
// ubuntu-26.04-bes-cloud-arm64-2026.10.01
export const AMI_UBUNTU_ARM64 = {
  'ap-south-1': 'ami-070e2a9548a67fa44',
  'ap-southeast-2': 'ami-0e92f874b2c51e5d8',
  'ap-southeast-6': 'ami-04053105df0fd2a82',
  'eu-central-2': 'ami-016ee1683dca3e5f1',
  'us-east-1': 'ami-0db25ee15c0717587',
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

export const DEFAULT_POSTGRES_VERSION = 18;

export const GATEWAY_CLASS_ENVOY = 'envoy-gateway';
