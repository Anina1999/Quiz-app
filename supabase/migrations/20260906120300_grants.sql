-- =============================================================================
--  QUIZ APP — изрични права върху таблиците
--
--  Проектът е създаден с изключено "Automatically expose new tables", затова
--  правата се дават ръчно тук. Това е втори слой защита освен RLS:
--    * RLS казва КОИ РЕДОВЕ вижда потребителят,
--    * GRANT казва ДАЛИ ИЗОБЩО има достъп до таблицата.
--
--  Ролята anon (некоментиран посетител, без сесия) не получава нищо.
--  Учениците ползват анонимно влизане, което ги прави authenticated, но без
--  ред в teachers и без съвпадащ auth.uid() RLS не им дава никакви редове —
--  затова целият им поток минава през SECURITY DEFINER функциите.
-- =============================================================================

grant usage on schema public to anon, authenticated;

-- Ролята anon не получава достъп до нито една таблица.
--
-- Правим го изрично, а не разчитаме на настройката "Automatically expose new
-- tables" в дашборда: ако някой я включи по-късно или схемата се пусне в друг
-- проект, ревокирането тук пак важи. Учениците ползват анонимно ВЛИЗАНЕ, което
-- ги прави authenticated — самата роля anon трябва да остане празна.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- И за таблици, създадени по-нататък.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Учителят чете и редактира собствения си профил, но не го създава сам
-- (създава го тригерът handle_new_teacher при регистрация).
grant select, update on public.teachers to authenticated;

grant select, insert, update, delete on public.classes  to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.quizzes  to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update, delete on public.answers   to authenticated;

-- Резултатите са само за четене от учителя. Пишат се единствено от
-- ученическите функции start_attempt / submit_answer / finish_attempt.
grant select, delete on public.attempts        to authenticated;
grant select          on public.attempt_answers to authenticated;

grant select on public.class_progress to authenticated;
