import { ECSClient, RunTaskCommand, RunTaskCommandInput } from '@aws-sdk/client-ecs';
import { CustomResourceOptions, Input } from '@pulumi/pulumi';
import { getConfig } from '@pulumi/pulumi/runtime';
import { Resource, ResourceProvider } from '@pulumi/pulumi/dynamic';

export interface EcsRunTaskResourceInputs {
  cluster: Input<string>;
  taskDefinition: Input<string>;
  runTaskCommand?: Input<RunTaskCommandInput>;
}

export interface EcsRunTaskInputs {
  cluster: string;
  taskDefinition: string;
  runTaskCommand?: RunTaskCommandInput;
}

export class EcsRunTask extends Resource {
  constructor(name: string, args: {}, opts?: CustomResourceOptions) {
    super(ecsRunTaskProvider, name, args, opts);
  }
}

function ecsClient() {
  const region = getConfig('aws:region');
  return new ECSClient({ region });
}

const ecsRunTaskProvider: ResourceProvider = {
  async create(inputs: EcsRunTaskInputs) {
    const client = ecsClient();
    const command = new RunTaskCommand({
      cluster: inputs.cluster,
      taskDefinition: inputs.taskDefinition,
      ...inputs.runTaskCommand,
    });

    const result = await client.send(command);
    const containerArn = result.tasks?.[0]?.containerInstanceArn;
    if (!containerArn) {
      throw new Error('RunTask did not start anything (no container instance ARN returned)');
    }

    return { id: containerArn, outs: result };
  },
};
