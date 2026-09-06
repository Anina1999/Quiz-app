-- =============================================================================
--  ПРОВЕРКА след пускане на full-schema.sql
--
--  Постави този файл в Supabase SQL Editor и натисни Run.
--  Всеки ред трябва да е с ✅. Ако някъде видиш ❌, кажи ми кой ред е.
-- =============================================================================

with checks as (

    -- Осемте таблици съществуват
    select 1 as nr,
           'Таблиците са създадени' as proverka,
           count(*)::text || ' от 8' as namereno,
           count(*) = 8 as ok
    from pg_tables
    where schemaname = 'public'
      and tablename in ('teachers', 'classes', 'students', 'quizzes',
                        'questions', 'answers', 'attempts', 'attempt_answers')

    union all

    -- RLS е включен на всяка от тях. Това е защитата — без нея всеки с anon
    -- ключа чете всичко.
    select 2,
           'Row Level Security е включен навсякъде',
           count(*)::text || ' от 8',
           count(*) = 8
    from pg_tables
    where schemaname = 'public'
      and tablename in ('teachers', 'classes', 'students', 'quizzes',
                        'questions', 'answers', 'attempts', 'attempt_answers')
      and rowsecurity

    union all

    -- Политиките за учителя
    select 3,
           'Политиките за достъп са на място',
           count(*)::text || ' политики',
           count(*) >= 18
    from pg_policies
    where schemaname = 'public'

    union all

    -- Ученическите функции, през които минава всичко без пряк достъп
    select 4,
           'Функциите за учениците съществуват',
           count(*)::text || ' от 7',
           count(*) = 7
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('class_preview', 'claim_student', 'student_quizzes',
                        'start_attempt', 'submit_answer', 'finish_attempt',
                        'student_progress')

    union all

    -- Учителските функции
    select 5,
           'Функциите за учителя съществуват',
           count(*)::text || ' от 3',
           count(*) = 3
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publish_quiz', 'regenerate_join_code', 'reset_class_sessions')

    union all

    -- Тригерът, който създава профил на учител при регистрация
    select 6,
           'Тригерът за нов учител е закачен',
           case when count(*) = 1 then 'да' else 'НЕ' end,
           count(*) = 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and not tgisinternal

    union all

    -- updated_at на шестте таблици, където го добавихме
    select 7,
           'updated_at се обновява автоматично',
           count(*)::text || ' от 6',
           count(*) = 6
    from pg_trigger
    where tgname like '%_touch_updated_at'
      and not tgisinternal

    union all

    -- Кодът за влизане се генерира сам при създаване на клас
    select 8,
           'Кодът за клас се генерира автоматично',
           coalesce(column_default, 'липсва'),
           column_default like '%generate_join_code%'
    from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'join_code'

    union all

    -- Изгледът за учителското табло
    select 9,
           'Изгледът class_progress съществува',
           case when count(*) = 1 then 'да' else 'НЕ' end,
           count(*) = 1
    from pg_views
    where schemaname = 'public' and viewname = 'class_progress'

    union all

    -- Ролята anon не бива да има права върху нито една таблица.
    -- Учениците ползват анонимно ВЛИЗАНЕ, което ги прави authenticated —
    -- самата роля anon трябва да е празна.
    select 10,
           'Ролята anon няма достъп до таблици',
           count(*)::text || ' права (трябва 0)',
           count(*) = 0
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'

    -- ===== Миграция 20260906120400 — обяснения и таймер по избор =============

    union all

    select 11,
           'Въпросите имат две полета за обяснение',
           count(*)::text || ' от 2',
           count(*) = 2
    from information_schema.columns
    where table_schema = 'public' and table_name = 'questions'
      and column_name in ('explanation_correct', 'explanation_wrong')

    union all

    select 12,
           'Таймерът може да се изключва',
           case when count(*) = 1 then 'да' else 'НЕ — пусни миграция 120400' end,
           count(*) = 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'quizzes'
      and column_name = 'time_per_question' and is_nullable = 'YES'

    union all

    -- Обяснението трябва да идва от submit_answer(), НЕ от start_attempt() —
    -- иначе би подсказало верния отговор предварително.
    select 13,
           'Базата избира кое обяснение да изпрати',
           case when count(*) = 1 then 'да' else 'НЕ — пусни миграция 120600' end,
           count(*) = 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_answer'
      and pg_get_functiondef(p.oid) like '%explanation_correct%'
      and pg_get_functiondef(p.oid) like '%explanation_wrong%'

    -- ===== Миграция 20260906120500 — прозорец за влизане =====================

    union all

    select 14,
           'Класовете имат прозорец за влизане',
           case when count(*) = 1 then 'да' else 'НЕ — пусни миграция 120500' end,
           count(*) = 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'classes'
      and column_name = 'joining_open_until'

    union all

    select 15,
           'Функциите за часа съществуват',
           count(*)::text || ' от 3',
           count(*) = 3
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('open_class', 'grant_grace', 'class_lesson_state')

    -- ===== Миграции 120700 и 120800 — режим на час =========================

    union all

    select 17,
           'Въпросите имат подсказка и заглавни редове',
           count(*)::text || ' от 3',
           count(*) = 3
    from information_schema.columns
    where table_schema = 'public' and table_name = 'questions'
      and column_name in ('hint', 'headline_correct', 'headline_wrong')

    union all

    select 18,
           'Редакцията се заключва по време на час',
           count(*)::text || ' от 3 тригера',
           count(*) = 3
    from pg_trigger
    where tgname in ('questions_editable', 'answers_editable', 'quizzes_editable')
      and not tgisinternal

    union all

    select 19,
           'Гратисът се разрешава от учителя',
           case when count(*) = 1 then 'да' else 'НЕ — пусни миграция 120800' end,
           count(*) = 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'grace_until'

    union all

    -- Учителят не бива да може да мести часовника с пряка заявка. Затова
    -- табличното UPDATE е отнето и са дадени само конкретните колони.
    select 20,
           'Часовникът не се мени с пряка заявка',
           count(*)::text || ' колони (трябва 0)',
           count(*) = 0
    from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'classes'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
      and column_name in ('joining_open_until', 'grace_until')

    union all

    -- Същинската защита: claim_student() трябва да проверява прозореца.
    -- Ако само class_preview го прави, кодът пак би пускал вътре.
    select 16,
           'Влизането наистина проверява прозореца',
           case when count(*) = 1 then 'да' else 'НЕ — пусни миграция 120500' end,
           count(*) = 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_student'
      and pg_get_functiondef(p.oid) like '%assert_joining_open%'
)

select nr as "№",
       case when ok then '✅' else '❌' end as "Ред",
       proverka as "Проверка",
       namereno as "Намерено"
from checks
order by nr;
