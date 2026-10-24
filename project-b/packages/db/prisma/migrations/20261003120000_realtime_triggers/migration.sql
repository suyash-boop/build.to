-- Realtime change feed. Statement-level triggers read the transition table and send one
-- pg_notify per affected project (or recipient) per statement. Notifications are delivered at
-- commit, and identical payloads within a transaction are collapsed by Postgres, so a bulk
-- reorder of 200 tasks produces one event. Payloads carry ids only, never row contents:
-- listeners decide who may see what.

CREATE OR REPLACE FUNCTION bldt_rt_by_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
  FOR pid IN SELECT DISTINCT "projectId" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', TG_ARGV[0], 'p', pid)::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION bldt_rt_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
  FOR pid IN SELECT DISTINCT "id" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', 'project', 'p', pid)::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION bldt_rt_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT "projectId", "userId" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', 'member', 'p', r."projectId", 'u', r."userId", 'op', lower(TG_OP))::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION bldt_rt_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid;
BEGIN
  FOR uid IN SELECT DISTINCT "recipientId" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', 'notification', 'u', uid)::text);
  END LOOP;
  RETURN NULL;
END $$;

-- Transition tables allow one event per trigger, hence three triggers per table.
DO $$
DECLARE
  spec text[];
  ev text;
  specs text[][] := ARRAY[
    ['Task', 'bldt_rt_by_project', 'task'],
    ['Comment', 'bldt_rt_by_project', 'comment'],
    ['Milestone', 'bldt_rt_by_project', 'milestone'],
    ['ActivityEvent', 'bldt_rt_by_project', 'activity'],
    ['Signal', 'bldt_rt_by_project', 'signal'],
    ['Project', 'bldt_rt_project', ''],
    ['ProjectMember', 'bldt_rt_member', ''],
    ['Notification', 'bldt_rt_notification', '']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    FOREACH ev IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      EXECUTE format(
        'CREATE TRIGGER %I AFTER %s ON %I REFERENCING %s TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION %I(%L)',
        'rt_' || lower(spec[1]) || '_' || lower(ev),
        ev,
        spec[1],
        CASE WHEN ev = 'DELETE' THEN 'OLD' ELSE 'NEW' END,
        spec[2],
        spec[3]
      );
    END LOOP;
  END LOOP;
END $$;
