import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import { dbRoleSecret } from '../../../../common/k8s/dbRoleSecret.ts';
import type { ManagedRole } from '../../../../common/k8s/postgres.ts';

export interface ReportingRolesArgs {
  parent: ComponentResource;
  server: string;
}

export interface ReportingRolesOutputs {
  raw: k8s.core.v1.Secret;
  reporting: k8s.core.v1.Secret;
  roles: ManagedRole[];
  initSql: string;
}

export function reportingRoles({ parent, server }: ReportingRolesArgs): ReportingRolesOutputs {
  const raw = dbRoleSecret({
    parent,
    name: `${server}-raw`,
    namespace,
    username: 'raw',
  });
  const reporting = dbRoleSecret({
    parent,
    name: `${server}-reporting`,
    namespace,
    username: 'reporting',
  });

  return {
    raw,
    reporting,
    roles: [
      {
        name: 'raw',
        passwordSecret: {
          name: raw.metadata.name,
        },
        login: true,
      },
      {
        name: 'reporting',
        passwordSecret: {
          name: reporting.metadata.name,
        },
        login: true,
      },
    ],
    initSql: `
      GRANT USAGE ON SCHEMA public TO raw;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO raw;
      GRANT USAGE ON SCHEMA reporting TO reporting;
      GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting;
      ALTER ROLE reporting SET search_path TO reporting;
    `
      .replace(/^[ \t]+/gm, '')
      .trim(),
  };
}
