-- =============================================================================
--  QUIZ APP — режим на час
--
--  Четири промени, които вървят заедно:
--
--  1. ПОДСКАЗКА към въпроса, която детето вижда ПРЕДИ да отговори
--     („Не бързай, пресметни. Използвай сметало.“).
--
--  2. ТЕКСТЪТ „Браво, вярно!“ става на учителя — той решава дали ще е
--     „Отлично!“, „Точно така!“ или друго. Ако не попълни нищо, остава
--     стойността по подразбиране.
--
--  3. ЗАКЛЮЧЕНА РЕДАКЦИЯ, докато класът е отворен. Тестът се поправя преди
--     часа, не по време на него — иначе едно дете отговаря на един въпрос, а
--     съученикът му на друг.
--
--  4. ПЕТ МИНУТИ ГРАТИС след затваряне на класа. Който още решава, довършва;
--     резултатът му се запазва и после достъпът спира.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1 и 2 — нови колони по въпроса
-- -----------------------------------------------------------------------------
alter table public.questions
    add column hint              text check (length(trim(hint)) between 1 and 300),
    add column headline_correct  text check (length(trim(headline_correct)) between 1 and 100),
    add column headline_wrong    text check (length(trim(headline_wrong)) between 1 and 200);

comment on column public.questions.hint is
    'Подсказка ПОД въпроса, видима преди отговора. За разлика от обясненията, тя пътува до браузъра заедно с въпроса — затова не бива да издава отговора.';

comment on column public.questions.headline_correct is
    'Заглавният ред при верен отговор („Отлично!“). NULL означава стойността по подразбиране.';

-- =============================================================================
--  3 — заключване на редакцията, докато класът е отворен
-- =============================================================================
create or replace function public.assert_quiz_editable(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_until timestamptz;
begin
    select c.joining_open_until
      into v_until
      from public.quizzes q
      join public.classes c on c.id = q.class_id
     where q.id = p_quiz_id;

    if v_until is not null and v_until > now() then
        raise exception 'Класът е отворен за влизане — затвори го, за да редактираш теста.'
            using errcode = 'P0001';
    end if;
end;
$$;

-- Въпроси: никаква промяна, докато часът тече.
create or replace function public.tg_questions_editable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform public.assert_quiz_editable(old.quiz_id);
        return old;
    end if;
    perform public.assert_quiz_editable(new.quiz_id);
    return new;
end;
$$;

create trigger questions_editable
    before insert or update or delete on public.questions
    for each row execute function public.tg_questions_editable();

-- Отговори: същото, през въпроса, на който принадлежат.
create or replace function public.tg_answers_editable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_quiz_id uuid;
begin
    select qn.quiz_id into v_quiz_id
      from public.questions qn
     where qn.id = coalesce(
         case when tg_op = 'DELETE' then old.question_id else new.question_id end,
         null);

    perform public.assert_quiz_editable(v_quiz_id);

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create trigger answers_editable
    before insert or update or delete on public.answers
    for each row execute function public.tg_answers_editable();

-- Тестът: заключва се само СЪДЪРЖАНИЕТО. Публикуването и скриването остават
-- позволени — точно тях учителят прави по време на часа.
create or replace function public.tg_quizzes_editable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform public.assert_quiz_editable(old.id);
        return old;
    end if;

    if tg_op = 'UPDATE' and (
           new.title             is distinct from old.title
        or new.subject           is distinct from old.subject
        or new.grade             is distinct from old.grade
        or new.class_id          is distinct from old.class_id
        or new.time_per_question is distinct from old.time_per_question
        or new.shuffle_questions is distinct from old.shuffle_questions
    ) then
        perform public.assert_quiz_editable(old.id);
    end if;

    return new;
end;
$$;

create trigger quizzes_editable
    before update or delete on public.quizzes
    for each row execute function public.tg_quizzes_editable();

-- =============================================================================
--  4 — гратисен период след затваряне на класа
-- =============================================================================
create or replace function public.grace_period()
returns interval
language sql
immutable
as $$ select interval '5 minutes'; $$;

/*
 * Затварянето вече записва МОМЕНТА на затваряне вместо NULL.
 *
 * Така една колона върши две работи: joining_open_until в бъдещето означава
 * "отворено", а в миналото — "затворено тогава", което позволява да се сметне
 * докога тече гратисът.
 */
create or replace function public.set_joining_window(p_class_id uuid, p_minutes int default 45)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_until timestamptz;
begin
    if not public.is_class_owner(p_class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    if p_minutes is null or p_minutes <= 0 then
        v_until := now();                                 -- затворено СЕГА
    else
        -- Таван от 8 часа: прозорец за цял ден е същото като изключена защита.
        v_until := now() + (least(p_minutes, 480) || ' minutes')::interval;
    end if;

    update public.classes set joining_open_until = v_until where id = p_class_id;
    return v_until;
end;
$$;

-- Докога този опит може да се решава. NULL при отворен клас = без ограничение.
create or replace function public.attempt_deadline(p_attempt_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
    select case
               when c.joining_open_until is null then a.started_at
               when c.joining_open_until > now() then null
               else c.joining_open_until + public.grace_period()
           end
    from public.attempts a
    join public.quizzes q on q.id = a.quiz_id
    join public.classes c on c.id = q.class_id
    where a.id = p_attempt_id;
$$;

/*
 * Колко време остава на детето. Ползва се от браузъра на всеки 20 секунди.
 *
 * Ако гратисът е изтекъл, опитът се приключва ТУК — така резултатът се запазва
 * дори детето да не натисне нищо повече.
 */
create or replace function public.attempt_status(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt  public.attempts;
    v_deadline timestamptz;
    v_left     int;
begin
    select * into v_attempt from public.attempts where id = p_attempt_id;
    if not found then
        raise exception 'Няма такъв опит.' using errcode = 'P0002';
    end if;

    perform public.assert_student_session(v_attempt.student_id);

    if v_attempt.finished_at is not null then
        return jsonb_build_object('finished', true, 'seconds_left', 0, 'in_grace', false);
    end if;

    v_deadline := public.attempt_deadline(p_attempt_id);

    if v_deadline is null then
        return jsonb_build_object('finished', false, 'seconds_left', null, 'in_grace', false);
    end if;

    v_left := greatest(0, ceil(extract(epoch from (v_deadline - now())))::int);

    if v_left = 0 then
        -- Времето свърши: запазваме резултата вместо да го изгубим.
        perform public.finish_attempt(p_attempt_id);
        return jsonb_build_object('finished', true, 'seconds_left', 0, 'in_grace', false);
    end if;

    return jsonb_build_object('finished', false, 'seconds_left', v_left, 'in_grace', true);
end;
$$;

-- =============================================================================
--  start_attempt() — сега изисква класът да е ОТВОРЕН и връща подсказките
-- =============================================================================
create or replace function public.start_attempt(p_student_id uuid, p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_student   public.students;
    v_class     public.classes;
    v_quiz      public.quizzes;
    v_attempt   public.attempts;
    v_max_score int;
begin
    v_student := public.assert_student_session(p_student_id);

    select * into v_class from public.classes where id = v_student.class_id;
    -- Нов тест се започва само докато часът тече. Гратисът е за ДОВЪРШВАНЕ.
    perform public.assert_joining_open(v_class);

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
                           -- Подсказката пътува с въпроса — тя е за ПРЕДИ
                           -- отговора. Обясненията остават в submit_answer.
                           'hint', qs.hint,
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
                select qn.id, qn.prompt, qn.hint, qn.image_url, qn.points,
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

-- =============================================================================
--  submit_answer() — заглавен ред от учителя + спазване на гратиса
-- =============================================================================
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
    v_deadline   timestamptz;
begin
    select * into v_attempt from public.attempts where id = p_attempt_id;
    if not found then
        raise exception 'Няма такъв опит.' using errcode = 'P0002';
    end if;

    perform public.assert_student_session(v_attempt.student_id);

    if v_attempt.finished_at is not null then
        raise exception 'Този тест вече е приключен.' using errcode = 'P0001';
    end if;

    -- Гратисът изтече: запазваме каквото има и спираме.
    v_deadline := public.attempt_deadline(p_attempt_id);
    if v_deadline is not null and v_deadline <= now() then
        perform public.finish_attempt(p_attempt_id);
        raise exception 'Времето за теста изтече. Резултатът ти е записан.'
            using errcode = 'P0001';
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

    insert into public.attempt_answers
        (attempt_id, question_id, answer_id, is_correct, time_taken_ms)
    values
        (p_attempt_id, p_question_id, p_answer_id, coalesce(v_is_correct, false),
         greatest(coalesce(p_time_taken_ms, 0), 0))
    on conflict (attempt_id, question_id) do nothing;

    return jsonb_build_object(
        'is_correct', coalesce(v_is_correct, false),
        'correct_answer_id', v_correct_id,
        -- Заглавният ред е на учителя; ако не е попълнил, слагаме нашия.
        'headline', case when coalesce(v_is_correct, false)
                         then coalesce(v_question.headline_correct, 'Браво, вярно!')
                         else coalesce(v_question.headline_wrong,
                                       'Не позна. Верният отговор е отбелязан.')
                    end,
        'explanation', case when coalesce(v_is_correct, false)
                            then v_question.explanation_correct
                            else v_question.explanation_wrong
                       end,
        'points', case when coalesce(v_is_correct, false) then v_question.points else 0 end
    );
end;
$$;

grant execute on function public.attempt_status(uuid)                to authenticated;
grant execute on function public.attempt_deadline(uuid)              to authenticated;
grant execute on function public.grace_period()                      to authenticated;
grant execute on function public.assert_quiz_editable(uuid)          to authenticated;
grant execute on function public.start_attempt(uuid, uuid)           to authenticated;
grant execute on function public.submit_answer(uuid, uuid, uuid, int) to authenticated;
grant execute on function public.set_joining_window(uuid, int)       to authenticated;
