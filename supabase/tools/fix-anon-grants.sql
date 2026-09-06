-- =============================================================================
--  ПОПРАВКА: маха останалите права на ролята anon
--
--  Пусни това в Supabase SQL Editor, ако проверка № 10 във verify.sql е с ❌.
--  Безопасно е да се пусне повторно — ако правата вече са махнати, не прави нищо.
--
--  Какво остава на anon след това: само USAGE върху схемата public, което ѝ
--  трябва, за да достигне до SQL функциите. Никакъв достъп до таблици.
--  Учениците не са засегнати — те влизат анонимно, което ги прави
--  authenticated, а не anon.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- И за таблици, които биха се създали по-нататък.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- anon трябва да може да стига до схемата, за да вика SQL функциите.
grant usage on schema public to anon;

-- --- Проверка веднага след поправката ----------------------------------------
select case when count(*) = 0 then '✅' else '❌' end as "Ред",
       'Ролята anon няма достъп до таблици'          as "Проверка",
       count(*)::text || ' права (трябва 0)'         as "Намерено"
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon';
