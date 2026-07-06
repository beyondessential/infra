export const AWS_ORG_ID = 'o-asiuh5s5mc';
export const AWS_ROOT_ID = 'r-veli';

// Tupaia predates `core` and intentionally uses its default VPC, so it is
// exempt from default-VPC cleanup and the create-default-VPC deny SCP.
export const AWS_TUPAIA_ACCOUNT_ID = '843218180240';

/// https://github.com/beyondessential/linux-images
// ubuntu-26.04-bes-cloud-amd64-2026.06.29
export const AMI_UBUNTU_AMD64 = {
  'ap-south-1': '	ami-06e826da58661b3ae',
  'ap-southeast-2': 'ami-0b3ddf371efbeb8b7',
  'ap-southeast-6': 'ami-0552a1045925d7b9b',
  'eu-central-2': 'ami-08ee1feb91417ef49',
  'us-east-1': 'ami-0764a4c2117ffc7b8',
};
// ubuntu-26.04-bes-cloud-arm64-2026.06.29
export const AMI_UBUNTU_ARM64 = {
  'ap-south-1': 'ami-07b63770360acde34',
  'ap-southeast-2': 'ami-0e21eded54b1fd411',
  'ap-southeast-6': 'ami-0506f190c24955967',
  'eu-central-2': 'ami-0227bdf715fe9c69b',
  'us-east-1': 'ami-098e0521b45df5c76',
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
