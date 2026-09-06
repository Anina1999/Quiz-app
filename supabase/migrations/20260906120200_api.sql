-- =============================================================================
--  QUIZ APP — API функции
--
--  Учениците нямат пряк достъп до таблиците (виж RLS миграцията). Всичко,
--  което правят, минава през тези SECURITY DEFINER функции, които сами си
--  проверяват правата. Двете важни последици:
--
--    1. Верните отговори никога не напускат базата преди детето да отговори.
--       Оценяването става в submit_answer(), не в браузъра.
--    2. С anon ключа не могат да се изброят класове, ученици или чужди
--       резултати — може само това, което функциите изрично позволяват.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Код за влизане в клас: 6 знака без 0/O/1/I/L, за да не се бъркат от децата.
-- -----------------------------------------------------------------------------
create or replace function public.generate_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v_code text;
    v_try  int;
    i      int;
begin
    for v_try in 1..50 loop
        v_code := '';
        for i in 1..6 loop
            v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
        end loop;

        if not exists (select 1 from public.classes c where c.join_code = v_code) then
            return v_code;
        end if;
    end loop;

    raise exception 'Не успях да генерирам уникален код за клас.';
end;
$$;

alter table public.classes
    alter column join_code set default public.generate_join_code();

-- =============================================================================
--  УЧИТЕЛСКИ ФУНКЦИИ
-- =============================================================================

-- Нов код за класа (например ако старият е изтекъл на дъската от миналия час).
create or replace function public.regenerate_join_code(p_class_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_code text;
begin
    if not public.is_class_owner(p_class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    v_code := public.generate_join_code();
    update public.classes set join_code = v_code where id = p_class_id;
    return v_code;
end;
$$;

-- Освобождава всички псевдоними в класа — за начало на нов час.
create or replace function public.reset_class_sessions(p_class_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count int;
begin
    if not public.is_class_owner(p_class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    update public.students
       set session_uid = null, session_claimed_at = null
     where class_id = p_class_id and session_uid is not null;

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

-- Публикуване на тест: пуска се към учениците само ако наистина е годен.
create or replace function public.publish_quiz(p_quiz_id uuid, p_publish boolean default true)
returns public.quizzes
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_quiz    public.quizzes;
    v_bad     record;
    v_count   int;
begin
    if not public.is_quiz_owner(p_quiz_id) then
        raise exception 'Нямате права над този тест.' using errcode = '42501';
    end if;

    if p_publish then
        select count(*) into v_count from public.questions where quiz_id = p_quiz_id;
        if v_count = 0 then
            raise exception 'Тестът няма нито един въпрос.';
        end if;

        select qn.position + 1 as nr,
               count(a.id) filter (where a.is_correct) as correct_count,
               count(a.id) as answer_count
          into v_bad
          from public.questions qn
          left join public.answers a on a.question_id = qn.id
         where qn.quiz_id = p_quiz_id
         group by qn.id, qn.position
        having count(a.id) < 2 or count(a.id) filter (where a.is_correct) <> 1
         order by qn.position
         limit 1;

        if found then
            if v_bad.answer_count < 2 then
                raise exception 'Въпрос № % има само % отговор(а). Нужни са поне 2.',
                    v_bad.nr, v_bad.answer_count;
            else
                raise exception 'Въпрос № % има % верни отговора. Трябва да е точно 1.',
                    v_bad.nr, v_bad.correct_count;
            end if;
        end if;

        if (select class_id from public.quizzes where id = p_quiz_id) is null then
            raise exception 'Изберете клас, на който да се покаже тестът.';
        end if;
    end if;

    update public.quizzes
       set is_published = p_publish
     where id = p_quiz_id
    returning * into v_quiz;

    return v_quiz;
end;
$$;

-- =============================================================================
--  УЧЕНИЧЕСКИ ФУНКЦИИ (анонимна сесия)
-- =============================================================================

-- Псевдоним се смята за "зает" само в рамките на учебния ден.
create or replace function public.student_session_ttl()
returns interval
language sql
immutable
as $$ select interval '6 hours'; $$;

-- Проверява, че текущата анонимна сесия наистина държи този ученик.
create or replace function public.assert_student_session(p_student_id uuid)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_student public.students;
begin
    if (select auth.uid()) is null then
        raise exception 'Няма активна сесия.' using errcode = '42501';
    end if;

    select * into v_student from public.students where id = p_student_id;

    if not found or v_student.session_uid is distinct from (select auth.uid()) then
        raise exception 'Влез отново в класа си.' using errcode = '42501';
    end if;

    return v_student;
end;
$$;

-- Списък с псевдонимите в класа по код — това вижда детето преди да избере себе си.
create or replace function public.class_preview(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class public.classes;
begin
    select * into v_class
      from public.classes
     where join_code = upper(trim(p_join_code)) and not archived;

    if not found then
        raise exception 'Няма клас с този код.' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
        'class', jsonb_build_object(
            'id', v_class.id,
            'name', v_class.name,
            'grade', v_class.grade
        ),
        'students', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', s.id,
                       'display_name', s.display_name,
                       'roll_number', s.roll_number,
                       'is_taken', s.session_uid is not null
                                   and s.session_uid is distinct from (select auth.uid())
                                   and s.session_claimed_at > now() - public.student_session_ttl()
                   ) order by coalesce(s.roll_number, 99), s.display_name)
            from public.students s
            where s.class_id = v_class.id
        ), '[]'::jsonb)
    );
end;
$$;

-- Детето избира своя псевдоним и го "заема" за този урок.
create or replace function public.claim_student(p_join_code text, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class   public.classes;
    v_student public.students;
    v_uid     uuid := (select auth.uid());
begin
    if v_uid is null then
        raise exception 'Няма активна сесия.' using errcode = '42501';
    end if;

    select * into v_class
      from public.classes
     where join_code = upper(trim(p_join_code)) and not archived;

    if not found then
        raise exception 'Няма клас с този код.' using errcode = 'P0002';
    end if;

    select * into v_student
      from public.students
     where id = p_student_id and class_id = v_class.id
       for update;

    if not found then
        raise exception 'Този ученик не е в класа.' using errcode = 'P0002';
    end if;

    if v_student.session_uid is not null
       and v_student.session_uid is distinct from v_uid
       and v_student.session_claimed_at > now() - public.student_session_ttl()
    then
        raise exception 'Някой друг вече е избрал този псевдоним.' using errcode = 'P0001';
    end if;

    -- Едно устройство държи най-много един псевдоним в класа.
    update public.students
       set session_uid = null, session_claimed_at = null
     where class_id = v_class.id and session_uid = v_uid and id <> p_student_id;

    update public.students
       set session_uid = v_uid, session_claimed_at = now()
     where id = p_student_id
    returning * into v_student;

    return jsonb_build_object(
        'student', jsonb_build_object(
            'id', v_student.id,
            'display_name', v_student.display_name,
            'roll_number', v_student.roll_number
        ),
        'class', jsonb_build_object(
            'id', v_class.id,
            'name', v_class.name,
            'grade', v_class.grade,
            'join_code', v_class.join_code
        )
    );
end;
$$;

-- Публикуваните тестове за класа на ученика + личният му най-добър резултат.
create or replace function public.student_quizzes(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_student public.students;
begin
    v_student := public.assert_student_session(p_student_id);

    return coalesce((
        select jsonb_agg(x order by x ->> 'title')
        from (
            select jsonb_build_object(
                'id', q.id,
                'title', q.title,
                'subject', q.subject,
                'time_per_question', q.time_per_question,
                'question_count', (select count(*) from public.questions qn where qn.quiz_id = q.id),
                'attempts_count', (select count(*) from public.attempts at
                                    where at.quiz_id = q.id and at.student_id = p_student_id
                                      and at.finished_at is not null),
                'best_score', (select max(at.score) from public.attempts at
                                where at.quiz_id = q.id and at.student_id = p_student_id
                                  and at.finished_at is not null),
                'max_score', (select coalesce(sum(qn.points), 0) from public.questions qn where qn.quiz_id = q.id)
            ) as x
            from public.quizzes q
            where q.class_id = v_student.class_id
              and q.is_published
              and exists (select 1 from public.questions qn where qn.quiz_id = q.id)
        ) t
    ), '[]'::jsonb);
end;
$$;

-- Стартира опит и връща въпросите БЕЗ информация кой отговор е верен.
create or replace function public.start_attempt(p_student_id uuid, p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_student   public.students;
    v_quiz      public.quizzes;
    v_attempt   public.attempts;
    v_max_score int;
begin
    v_student := public.assert_student_session(p_student_id);

    select * into v_quiz
      from public.quizzes
     where id = p_quiz_id and is_published and class_id = v_student.class_id;

    if not found then
        raise exception 'Тестът не е достъпен за твоя клас.' using errcode = '42501';
    end if;

    select coalesce(sum(points), 0) into v_max_score
      from public.questions where quiz_id = p_quiz_id;

    if v_max_score = 0 then
        raise exception 'Тестът няма въпроси.' using errcode = 'P0002';
    end if;

    insert into public.attempts (quiz_id, student_id, max_score)
    values (p_quiz_id, p_student_id, v_max_score)
    returning * into v_attempt;

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'quiz', jsonb_build_object(
            'id', v_quiz.id,
            'title', v_quiz.title,
            'subject', v_quiz.subject,
            'time_per_question', v_quiz.time_per_question
        ),
        'max_score', v_max_score,
        'questions', coalesce((
            select jsonb_agg(
                       jsonb_build_object(
                           'id', qs.id,
                           'prompt', qs.prompt,
                           'image_url', qs.image_url,
                           'points', qs.points,
                           'answers', coalesce((
                               select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text)
                                                order by random())
                               from public.answers a
                               where a.question_id = qs.id
                           ), '[]'::jsonb)
                       ) order by qs.ord)
            from (
                select qn.id, qn.prompt, qn.image_url, qn.points,
                       row_number() over (
                           order by case when v_quiz.shuffle_questions
                                         then random()
                                         else qn.position::float8 end
                       ) as ord
                from public.questions qn
                where qn.quiz_id = p_quiz_id
            ) qs
        ), '[]'::jsonb)
    );
end;
$$;

-- Оценява един отговор. p_answer_id = NULL означава "времето изтече".
create or replace function public.submit_answer(
    p_attempt_id    uuid,
    p_question_id   uuid,
    p_answer_id     uuid,
    p_time_taken_ms int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt    public.attempts;
    v_question   public.questions;
    v_is_correct boolean := false;
    v_correct_id uuid;
begin
    select * into v_attempt from public.attempts where id = p_attempt_id;
    if not found then
        raise exception 'Няма такъв опит.' using errcode = 'P0002';
    end if;

    perform public.assert_student_session(v_attempt.student_id);

    if v_attempt.finished_at is not null then
        raise exception 'Този тест вече е приключен.' using errcode = 'P0001';
    end if;

    select * into v_question
      from public.questions
     where id = p_question_id and quiz_id = v_attempt.quiz_id;

    if not found then
        raise exception 'Въпросът не е от този тест.' using errcode = 'P0002';
    end if;

    select a.id into v_correct_id
      from public.answers a
     where a.question_id = p_question_id and a.is_correct
     limit 1;

    if p_answer_id is not null then
        select a.is_correct into v_is_correct
          from public.answers a
         where a.id = p_answer_id and a.question_id = p_question_id;

        if not found then
            raise exception 'Отговорът не е от този въпрос.' using errcode = 'P0002';
        end if;
    end if;

    -- ON CONFLICT DO NOTHING пази от повторно отговаряне на същия въпрос.
    insert into public.attempt_answers
        (attempt_id, question_id, answer_id, is_correct, time_taken_ms)
    values
        (p_attempt_id, p_question_id, p_answer_id, coalesce(v_is_correct, false),
         greatest(coalesce(p_time_taken_ms, 0), 0))
    on conflict (attempt_id, question_id) do nothing;

    return jsonb_build_object(
        'is_correct', coalesce(v_is_correct, false),
        'correct_answer_id', v_correct_id,
        'points', case when coalesce(v_is_correct, false) then v_question.points else 0 end
    );
end;
$$;

-- Приключва опита и записва окончателния резултат.
create or replace function public.finish_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.attempts;
    v_score   int;
begin
    select * into v_attempt from public.attempts where id = p_attempt_id;
    if not found then
        raise exception 'Няма такъв опит.' using errcode = 'P0002';
    end if;

    perform public.assert_student_session(v_attempt.student_id);

    if v_attempt.finished_at is not null then
        return jsonb_build_object('score', v_attempt.score, 'max_score', v_attempt.max_score);
    end if;

    select coalesce(sum(qn.points), 0) into v_score
      from public.attempt_answers aa
      join public.questions qn on qn.id = aa.question_id
     where aa.attempt_id = p_attempt_id and aa.is_correct;

    update public.attempts
       set score = v_score, finished_at = now()
     where id = p_attempt_id
    returning * into v_attempt;

    return jsonb_build_object('score', v_attempt.score, 'max_score', v_attempt.max_score);
end;
$$;

-- Личният напредък на детето по учебен предмет.
create or replace function public.student_progress(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.assert_student_session(p_student_id);

    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'subject', t.subject,
                   'attempts', t.attempts,
                   'percent', t.percent
               ) order by t.subject)
        from (
            select q.subject,
                   count(*) as attempts,
                   round(100.0 * sum(a.score) / nullif(sum(a.max_score), 0)) as percent
            from public.attempts a
            join public.quizzes q on q.id = a.quiz_id
            where a.student_id = p_student_id and a.finished_at is not null
            group by q.subject
        ) t
    ), '[]'::jsonb);
end;
$$;

-- =============================================================================
--  Изглед за учителското табло: напредък по ученик и по тема.
--  RLS на attempts/quizzes се прилага автоматично (security_invoker),
--  така че всеки учител вижда само своите класове.
-- =============================================================================
create view public.class_progress
with (security_invoker = true)
as
select c.id                                   as class_id,
       c.name                                 as class_name,
       s.id                                   as student_id,
       s.display_name,
       s.roll_number,
       q.subject,
       count(a.id)                            as attempts,
       max(a.finished_at)                     as last_attempt_at,
       sum(a.score)                           as total_score,
       sum(a.max_score)                       as total_max_score,
       round(100.0 * sum(a.score) / nullif(sum(a.max_score), 0)) as percent
from public.students s
join public.classes c   on c.id = s.class_id
join public.attempts a  on a.student_id = s.id and a.finished_at is not null
join public.quizzes q   on q.id = a.quiz_id
group by c.id, c.name, s.id, s.display_name, s.roll_number, q.subject;

-- =============================================================================
--  Права за изпълнение
-- =============================================================================
revoke execute on all functions in schema public from public, anon;

-- Помощните функции се извикват вътре в RLS политиките, които се оценяват
-- като извикващия потребител — затова им трябва изрично EXECUTE.
grant execute on function public.is_class_owner(uuid)              to authenticated;
grant execute on function public.is_quiz_owner(uuid)               to authenticated;
grant execute on function public.is_question_owner(uuid)           to authenticated;
-- generate_join_code() е DEFAULT на classes.join_code и се изпълнява
-- при INSERT от името на учителя.
grant execute on function public.generate_join_code()              to authenticated;
grant execute on function public.student_session_ttl()             to authenticated;
grant execute on function public.assert_student_session(uuid)      to authenticated;

grant execute on function public.regenerate_join_code(uuid)        to authenticated;
grant execute on function public.reset_class_sessions(uuid)        to authenticated;
grant execute on function public.publish_quiz(uuid, boolean)       to authenticated;

grant execute on function public.class_preview(text)                        to authenticated;
grant execute on function public.claim_student(text, uuid)                  to authenticated;
grant execute on function public.student_quizzes(uuid)                      to authenticated;
grant execute on function public.start_attempt(uuid, uuid)                  to authenticated;
grant execute on function public.submit_answer(uuid, uuid, uuid, int)       to authenticated;
grant execute on function public.finish_attempt(uuid)                       to authenticated;
grant execute on function public.student_progress(uuid)                     to authenticated;
