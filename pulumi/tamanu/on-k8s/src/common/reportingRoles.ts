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
    // initsql runs before the roles are created/updated by the above
    // and also before anything is migrated by the application, so
    // the reporting schema is not available.
    //
    // Tamanu creates and manages its own tamanu_reporting/tamanu_raw roles at
    // startup, so the app role needs CREATEROLE. The raw/reporting roles below
    // are legacy and unused by Tamanu.
    initSql: `
      CREATE ROLE raw LOGIN;
      CREATE ROLE reporting LOGIN;
      GRANT USAGE ON SCHEMA public TO raw;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO raw;
      ALTER ROLE app CREATEROLE;
    `
      .replace(/^[ \t]+/gm, '')
      .trim(),
  };
}
