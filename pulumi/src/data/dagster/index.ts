import { failIfIncorrectAccount } from '../../common/coreRef.js';
import { ghaDagsterRole } from './github.js';
failIfIncorrectAccount();

export const ghaDagsterRoleArn = ghaDagsterRole.arn;
