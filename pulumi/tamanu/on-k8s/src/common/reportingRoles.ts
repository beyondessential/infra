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
      // `app` must not be a managed role: CNPG forces every attribute of a
      // managed role back to the manifest and revokes memberships not listed in
      // inRoles, which strips the ADMIN OPTION grants the reporting-grants job
      // applies (and inRoles cannot express ADMIN OPTION). CREATEROLE on `app`
      // is reconciled by that job instead.
    ],
    // initSql runs before the app migrates, so the reporting schema doesn't
    // exist yet. The ALTER grants `app` CREATEROLE at first bootstrap (the
    // reporting-grants job covers existing clusters on each deploy).
    // raw/reporting are legacy, unused by Tamanu.
    // TODO: remove them once no longer needed.
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
