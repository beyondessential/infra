import { test } from 'node:test';
import { equal, throws } from 'node:assert/strict';
import { type CoreZone, coreZones, dnsZoneList } from './dns-zone-list.ts';

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

const ROLE = 'arn:aws:iam::723528227656:role/canopy-dns';

test('a core brings its extra zones along with its primary one', () => {
  equal(
    dnsZoneList(
      CANOPY_ACCOUNT,
      coreZones(
        'bes/core/tamanu-palau-prod',
        '723528227656',
        ROLE,
        { apex: 'palau.tamanu.app', id: 'Z1' },
        {
          'tamanu-palau.org': 'Z2',
        },
      ),
    ),
    `palau.tamanu.app=Z1=${ROLE},tamanu-palau.org=Z2=${ROLE}`,
  );
});

test('a core with extra zones only is still a zone-holder', () => {
  equal(
    dnsZoneList(
      CANOPY_ACCOUNT,
      coreZones('bes/core/x', '723528227656', ROLE, {}, { 'x.example': 'Z2' }),
    ),
    `x.example=Z2=${ROLE}`,
  );
});

test('a core that has not published extra zones is just its primary zone', () => {
  equal(
    dnsZoneList(
      CANOPY_ACCOUNT,
      coreZones('bes/core/x', '723528227656', ROLE, { apex: 'x.tamanu.app', id: 'Z1' }, undefined),
    ),
    `x.tamanu.app=Z1=${ROLE}`,
  );
});

test('a core with no zone at all is still refused', () => {
  throws(
    () => dnsZoneList(CANOPY_ACCOUNT, coreZones('bes/core/x', '723528227656', ROLE, {}, {})),
    /publishes no DNS zone/,
  );
});
