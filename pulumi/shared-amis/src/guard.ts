import { accountId } from '../../common/awsAccount.ts';
import { expectedAccountId } from './config.ts';

accountId.apply((id) => {
  if (id !== expectedAccountId) {
    throw new Error(
      `Refusing to run: current account ${id} is not the expected shared-amis account ${expectedAccountId}`,
    );
  }
});
