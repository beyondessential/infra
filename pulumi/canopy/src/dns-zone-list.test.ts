import { test } from 'node:test';
import { equal, throws } from 'node:assert/strict';
import { type CoreZone, dnsZoneList } from './dns-zone-list.ts';

const CANOPY_ACCOUNT = '143295493206';

const zone = (over: Partial<CoreZone> = {}): CoreZone => ({
  stack: 'bes/core/tamanu-fsm-prod',
  account: '723528227656',
  apex: 'fsm.tamanu.app',
  id: 'Z08923',
  roleArn: 'arn:aws:iam::723528227656:role/canopy-dns',
  ...over,
});

test('a zone in canopy’s own account needs no role', () => {
  equal(
    dnsZoneList(CANOPY_ACCOUNT, [
      zone({
        stack: 'bes/core/tamanu-internal',
        account: CANOPY_ACCOUNT,
        apex: 'tamanu.app',
        id: 'Z0841',
        roleArn: undefined,
      }),
    ]),
    'tamanu.app=Z0841',
  );
});

test('a zone elsewhere carries the role to assume', () => {
  equal(
    dnsZoneList(CANOPY_ACCOUNT, [zone()]),
    'fsm.tamanu.app=Z08923=arn:aws:iam::723528227656:role/canopy-dns',
  );
});

test('a role published for a same-account zone is not used', () => {
  equal(
    dnsZoneList(CANOPY_ACCOUNT, [
      zone({ account: CANOPY_ACCOUNT, roleArn: 'arn:aws:iam::143295493206:role/canopy-dns' }),
    ]),
    'fsm.tamanu.app=Z08923',
  );
});

test('several zones are one comma-separated list', () => {
  equal(
    dnsZoneList(CANOPY_ACCOUNT, [
      zone({ account: CANOPY_ACCOUNT, apex: 'tamanu.app', id: 'Z0841', roleArn: undefined }),
      zone(),
    ]),
    'tamanu.app=Z0841,fsm.tamanu.app=Z08923=arn:aws:iam::723528227656:role/canopy-dns',
  );
});

test('a cross-account zone with no role is refused rather than written roleless', () => {
  throws(() => dnsZoneList(CANOPY_ACCOUNT, [zone({ roleArn: undefined })]), /no canopyDnsRoleArn/);
});

test('a stack with no zone is refused', () => {
  throws(() => dnsZoneList(CANOPY_ACCOUNT, [zone({ apex: undefined })]), /publishes no DNS zone/);
  throws(() => dnsZoneList(CANOPY_ACCOUNT, [zone({ id: undefined })]), /publishes no DNS zone/);
});
