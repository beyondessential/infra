-- Give a Tamanu facility a new id, without moving its clinical history.
--
-- Adds a facility row under :new_id, moves the structural reference data onto
-- it, and leaves the :old_id row and everything else pointing at it in place.
-- Run against both the central and the facility database of a deployment.
--
-- Requires -v old_id=... -v new_id=... -v new_code=..., and psql's
-- ON_ERROR_STOP so a failed statement aborts rather than committing a partial
-- rename.

\set ON_ERROR_STOP on

BEGIN;

-- Copy the whole row rather than naming columns, so this keeps working as the
-- facilities table gains them.
CREATE TEMP TABLE renamed_facility ON COMMIT DROP AS
  SELECT * FROM facilities WHERE id = :'old_id';

UPDATE renamed_facility SET id = :'new_id', code = :'new_code';

INSERT INTO facilities SELECT * FROM renamed_facility;

-- The tick the moved rows are stamped with. Sync sends a record when its tick is
-- newer than the receiver's last pull, and nothing in the database maintains
-- this column — Tamanu sets it in application code — so a plain UPDATE would be
-- invisible to sync.
CREATE TEMP TABLE tick ON COMMIT DROP AS
  SELECT value::bigint AS value FROM local_system_facts WHERE key = 'currentSyncTick';

-- The structural reference data that makes a facility usable: without these the
-- facility server comes up with nowhere to admit a patient to.
UPDATE departments
   SET facility_id = :'new_id', updated_at_sync_tick = (SELECT value FROM tick)
 WHERE facility_id = :'old_id';

UPDATE locations
   SET facility_id = :'new_id', updated_at_sync_tick = (SELECT value FROM tick)
 WHERE facility_id = :'old_id';

UPDATE location_groups
   SET facility_id = :'new_id', updated_at_sync_tick = (SELECT value FROM tick)
 WHERE facility_id = :'old_id';

UPDATE user_facilities
   SET facility_id = :'new_id', updated_at_sync_tick = (SELECT value FROM tick)
 WHERE facility_id = :'old_id';

-- Moving a row is not enough when what it points at has never been sent. A
-- facility receives only the users linked to it, so re-ticking user_facilities
-- alone pushes links whose users the facility has never seen, and the insert
-- fails on user_facilities_user_id_fkey. Re-tick the users so they travel too.
UPDATE users
   SET updated_at_sync_tick = (SELECT value FROM tick)
 WHERE id IN (SELECT user_id FROM user_facilities WHERE facility_id = :'new_id');

UPDATE patient_facilities
   SET facility_id = :'new_id', updated_at_sync_tick = (SELECT value FROM tick)
 WHERE facility_id = :'old_id';

UPDATE settings
   SET facility_id = :'new_id', updated_at_sync_tick = (SELECT value FROM tick)
 WHERE facility_id = :'old_id';

-- sync_lookup caches what central sends out, including a denormalised
-- facility_id that for some record types (appointments, appointment_schedules)
-- is derived through locations — which just moved. Listing the affected models
-- in lookupModelsToRebuild is Tamanu's own way of invalidating that cache;
-- deleting the rows directly would leave them missing instead, since a refresh
-- only picks up records whose tick advanced.
UPDATE local_system_facts
   SET value = (
         SELECT string_agg(DISTINCT model, ',')
           FROM (
             SELECT unnest(string_to_array(value, ',')) AS model
             UNION
             SELECT unnest(ARRAY[
               'appointments',
               'appointment_schedules',
               'patient_facilities',
               'settings'
             ])
           ) AS models
           WHERE model <> ''
       )
 WHERE key = 'lookupModelsToRebuild';

COMMIT;
