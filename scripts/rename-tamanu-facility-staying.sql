-- Rows that stay on the old facility id: everything referencing a facility that
-- rename-tamanu-facility.sql deliberately does not move, so what is being left
-- behind is visible rather than implied. Requires -v old_id=...

\pset pager off

-- Schema-qualified: the audit log's accesses table lives outside public, and
-- reporting carries views of several of these.
select 'logs.accesses: ' || count(*) from logs.accesses where facility_id = :'old_id'
union all select 'assets: ' || count(*) from public.assets where facility_id = :'old_id'
union all select 'patient_additional_data: ' || count(*) from public.patient_additional_data where health_center_id = :'old_id'
union all select 'patient_birth_data: ' || count(*) from public.patient_birth_data where birth_facility_id = :'old_id'
union all select 'patient_death_data: ' || count(*) from public.patient_death_data where facility_id = :'old_id'
union all select 'patient_program_registrations: ' || count(*) from public.patient_program_registrations where facility_id = :'old_id' or registering_facility_id = :'old_id'
union all select 'pharmacy_orders: ' || count(*) from public.pharmacy_orders where facility_id = :'old_id'
union all select 'portal_survey_assignments: ' || count(*) from public.portal_survey_assignments where facility_id = :'old_id'
union all select 'reference_drug_facilities: ' || count(*) from public.reference_drug_facilities where facility_id = :'old_id'
union all select 'report_requests: ' || count(*) from public.report_requests where facility_id = :'old_id'
union all select 'user_preferences: ' || count(*) from public.user_preferences where facility_id = :'old_id';
