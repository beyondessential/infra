import { elasticbeanstalk } from "@pulumi/aws";
import { getStack } from "@pulumi/pulumi";
const { Application, Environment } = elasticbeanstalk;

const TAGS = {
  "bes:platform": "tamanu",
};

const centralApp = new Application(`${getStack()}-server`, {
  name: "tamanu-sync-server",
  appversionLifecycle: {
    deleteSourceFromS3: true,
    maxCount: 200,
    serviceRole: "arn:aws:iam::843218180240:role/aws-elasticbeanstalk-service-role",
  },
  tags: TAGS,
}, {
  protect: true,
});

const centralEnv = new Environment(`${getStack()}-server-dev`, {
  application: centralApp.name,
  name: "tamanu-central-server-dev-16",
  platformArn: "arn:aws:elasticbeanstalk:ap-southeast-2::platform/Node.js 16 running on 64bit Amazon Linux 2/5.8.0",
  tags: TAGS,
}, {
    protect: true,
});
