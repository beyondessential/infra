-- Rows attached to the old and new facility ids, for the tables
-- rename-tamanu-facility.sql moves. Requires -v old_id=... -v new_id=...

\pset pager off

select 'facilities' as tbl,
       (select count(*) from facilities where id = :'old_id') as old,
       (select count(*) from facilities where id = :'new_id') as new
union all select 'departments',
       (select count(*) from departments where facility_id = :'old_id'),
       (select count(*) from departments where facility_id = :'new_id')
union all select 'locations',
       (select count(*) from locations where facility_id = :'old_id'),
       (select count(*) from locations where facility_id = :'new_id')
union all select 'location_groups',
       (select count(*) from location_groups where facility_id = :'old_id'),
       (select count(*) from location_groups where facility_id = :'new_id')
union all select 'user_facilities',
       (select count(*) from user_facilities where facility_id = :'old_id'),
       (select count(*) from user_facilities where facility_id = :'new_id')
union all select 'patient_facilities',
       (select count(*) from patient_facilities where facility_id = :'old_id'),
       (select count(*) from patient_facilities where facility_id = :'new_id')
union all select 'settings',
       (select count(*) from settings where facility_id = :'old_id'),
       (select count(*) from settings where facility_id = :'new_id')
union all select 'sync_lookup',
       (select count(*) from sync_lookup where facility_id = :'old_id'),
       (select count(*) from sync_lookup where facility_id = :'new_id');
