import { Output } from '@pulumi/pulumi';
import { stackName, failIfIncorrectAccountOrRegion } from '../../common/coreRef.ts';
await failIfIncorrectAccountOrRegion();

import './github.ts';
