-- VALE Connect database structure snapshot.
-- Read-only: one SELECT over Postgres system catalogs. It returns structure and
-- access rules only, never table rows, so no card, contact or account data.
-- Run it in the Supabase dashboard SQL editor after confirming the selected
-- project, then save the single result cell. Review before sharing it.
SELECT jsonb_pretty(jsonb_build_object(
 'snapshot_format', 1,
 'postgres_version', current_setting('server_version'),
 'schemas', (SELECT coalesce(jsonb_agg(nspname ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'),
 'extensions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname),'[]')
   FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity,
     'view_definition',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) END,'acl',c.relacl::text) ORDER BY c.relname),'[]')
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')),
 'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
     'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'column_acl',a.attacl::text) ORDER BY c.relname,a.attnum),'[]')
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped),
 'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]')
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname),'[]') FROM pg_indexes WHERE schemaname='public'),
 'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'with_check',with_check) ORDER BY tablename,policyname),'[]')
   FROM pg_policies WHERE schemaname='public'),
 'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.proname,p.oid),'[]')
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind IN ('f','p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')),
 'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname),'[]')
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT t.tgisinternal AND (n.nspname='public' OR (n.nspname='auth' AND c.relname='users'))),
 'event_triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'owner',pg_get_userbyid(e.evtowner),'function',e.evtfoid::regprocedure::text,'tags',e.evttags) ORDER BY e.evtname),'[]')
   FROM pg_event_trigger e),
 'default_privileges', (SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'object_type',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype),'[]')
   FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
 'publication_tables', (SELECT coalesce(jsonb_agg(jsonb_build_object('publication',pubname,'table',tablename) ORDER BY pubname,tablename),'[]') FROM pg_publication_tables WHERE schemaname='public')
)) AS vale_structure_snapshot;
