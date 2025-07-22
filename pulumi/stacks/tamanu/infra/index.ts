import { Output } from '@pulumi/pulumi';
import { stackName, failIfIncorrectAccount } from '../../common/coreRef.ts';
failIfIncorrectAccount();

import './github.ts';
