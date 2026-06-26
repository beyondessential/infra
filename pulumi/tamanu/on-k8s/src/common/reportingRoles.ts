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
      {
        // `app` is the cluster owner Tamanu connects as; it self-provisions the
        // tamanu_reporting/tamanu_raw roles at startup and so needs CREATEROLE.
        // Declared as a managed role (not only in initSql) so CNPG reconciles
        // CREATEROLE onto EXISTING clusters too — initSql runs once at first
        // bootstrap, so an in-place upgrade would otherwise leave `app` without
        // it and every server would crash on startup.
        //
        // No passwordSecret: CNPG then leaves app's bootstrap-managed password
        // untouched. The other attributes already match CNPG's managed defaults
        // (super/createdb/replication/bypassrls off, inherit on), so this only
        // adds CREATEROLE and changes nothing else.
        name: 'app',
        login: true,
        createrole: true,
      },
    ],
    // initSql runs before the managed roles above and before the app migrates,
    // so the reporting schema doesn't exist yet. The ALTER grants `app`
    // CREATEROLE at first bootstrap (the managed role above covers existing
    // clusters on reconcile). raw/reporting are legacy, unused by Tamanu.
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
