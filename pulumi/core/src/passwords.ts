import * as aws from '@pulumi/aws';

new aws.iam.AccountPasswordPolicy('iam-passwords', {
  minimumPasswordLength: 15, // drata mandates 14
  maxPasswordAge: 0, // expiry leads to weaker security
  passwordReusePrevention: 24, // drata requirement
  allowUsersToChangePassword: true,
});
