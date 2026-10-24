-- Live updates for discussions: same statement-level pattern as the realtime_triggers migration.
DO $$
DECLARE
  spec text[];
  ev text;
  specs text[][] := ARRAY[
    ['Discussion', 'bldt_rt_by_project', 'discussion'],
    ['DiscussionReply', 'bldt_rt_by_project', 'discussion']
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
