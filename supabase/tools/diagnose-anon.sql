-- =============================================================================
--  ДИАГНОСТИКА: кои права има ролята anon и КОЙ ѝ ги е дал
--
--  Пусни това в Supabase SQL Editor и ми прати резултата от двете заявки.
--  Ключовата колона е "Дал правата" — REVOKE маха само права, дадени от
--  текущата роля, затова трябва да знаем кой е грантор.
-- =============================================================================

-- Заявка 1: кой съм аз в момента
select current_user                                        as "Изпълнявам като",
       (select rolsuper from pg_roles where rolname = current_user) as "Суперпотребител",
       pg_has_role(current_user, 'anon', 'MEMBER')          as "Член съм на anon",
       pg_has_role(current_user, 'supabase_admin', 'MEMBER') as "Член съм на supabase_admin";

-- Заявка 2: точно кои права, върху какво и от кого
select table_name    as "Таблица",
       privilege_type as "Право",
       grantor        as "Дал правата"
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
order by grantor, table_name, privilege_type;
