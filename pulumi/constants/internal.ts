export const AWS_ORG_ID = 'o-asiuh5s5mc';
export const AWS_ROOT_ID = 'r-veli';
export const AWS_PRIMARY_ACCOUNT_ID = '295280690919';

// Tupaia predates `core` and intentionally uses its default VPC, so it is
// exempt from default-VPC cleanup and the create-default-VPC deny SCP.
export const AWS_TUPAIA_ACCOUNT_ID = '843218180240';

/// https://github.com/beyondessential/linux-images
// ubuntu-26.04-bes-cloud-amd64-2026.10.20
export const AMI_UBUNTU_AMD64 = {
  'ap-south-1': 'ami-0dd7ef1589df79344',
  'ap-southeast-2': 'ami-0b6ffdb035715a63a',
  'ap-southeast-6': 'ami-0ef03a21106c779dc',
  'eu-central-2': 'ami-06792c97ad639a33c',
  'us-east-1': 'ami-0c8a58bc7a1b65f8e',
};
// ubuntu-26.04-bes-cloud-arm64-2026.10.20
export const AMI_UBUNTU_ARM64 = {
  'ap-south-1': 'ami-04c36ce1e5e645e8c',
  'ap-southeast-2': 'ami-0ff31825c3c238307',
  'ap-southeast-6': 'ami-02f81ff1597a1145b',
  'eu-central-2': 'ami-0d69e2aec9dbf6f5d',
  'us-east-1': 'ami-051fb1b9f810329e4',
};

export const AWS_TAMANU_INTERNAL_CERTBOT_POLICY = 'arn:aws:iam::143295493206:policy/CertbotRenewal';

export const TAILNET_ID = 'TZAJWRvY3B11CNTRL';
export const TAILNET_DOMAIN = 'tail53aef.ts.net';

export const LOGS_BUCKETS = {
  TAMANU: 'bes-tamanu-logs',
  DATA: 'bes-data-logs',
  TUPAIA: 'bes-tupaia-logs',
};

export const DEFAULT_POSTGRES_VERSION = 18;

export const GATEWAY_CLASS_ENVOY = 'envoy-gateway';
