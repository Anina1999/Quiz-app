-- =============================================================================
--  QUIZ APP — часът върви до края си, гратисът се разрешава от учителя
--
--  Какво се променя спрямо предната миграция:
--
--  1. Прозорецът НЕ може да се удължава и НЕ може да се затваря по-рано.
--     Учителят избира веднъж колко минути и часът си върви. Иначе „още 5
--     минути“ се превръща в безкраен час, а децата не знаят докога решават.
--
--  2. Гратисът вече НЕ е автоматичен. Когато времето изтече и има деца, които
--     още решават, учителят получава въпрос: „Да им дам ли още 5 минути?“
--     Само ако отговори „Да“, те продължават — и вижда брояч.
--
--  3. Един гратис на час. Втори път не се разрешава.
-- =============================================================================

alter table public.classes
    add column grace_until timestamptz;

comment on column public.classes.grace_until is
    'Докога тече разрешеният от учителя гратис. NULL или стойност преди joining_open_until означава, че гратис не е даван за текущия час.';

-- Докога изобщо може да се решава: краят на часа или краят на гратиса.
create or replace function public.class_play_until(p_class public.classes)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
    select case
               when p_class.grace_until is not null
                    and p_class.grace_until > p_class.joining_open_until
               then p_class.grace_until
               else p_class.joining_open_until
           end;
$$;

-- -----------------------------------------------------------------------------
--  Отваряне на класа. Само когато е затворен — без удължаване по средата.
-- -----------------------------------------------------------------------------
drop function if exists public.set_joining_window(uuid, int);

create or replace function public.open_class(p_class_id uuid, p_minutes int default 45)
returns public.classes
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class public.classes;
begin
    if not public.is_class_owner(p_class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    if p_minutes is null or p_minutes <= 0 then
        raise exception 'Изберете за колко минути да е отворен класът.' using errcode = 'P0001';
    end if;

    select * into v_class from public.classes where id = p_class_id for update;

    -- Ключовото ограничение: докато часът или гратисът текат, нищо не се пипа.
    if public.class_play_until(v_class) > now() then
        raise exception 'Часът вече тече. Изчакай да свърши — времето не може да се променя.'
            using errcode = 'P0001';
    end if;

    update public.classes
       set joining_open_until = now() + (least(p_minutes, 480) || ' minutes')::interval,
           grace_until = null                       -- нов час, нов гратис
     where id = p_class_id
    returning * into v_class;

    return v_class;
end;
$$;

-- -----------------------------------------------------------------------------
--  Гратис — само след изтичане на часа и само веднъж.
-- -----------------------------------------------------------------------------
create or replace function public.grant_grace(p_class_id uuid)
returns public.classes
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class public.classes;
begin
    if not public.is_class_owner(p_class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    select * into v_class from public.classes where id = p_class_id for update;

    if v_class.joining_open_until is null then
        raise exception 'Класът не е бил отварян.' using errcode = 'P0001';
    end if;

    if v_class.joining_open_until > now() then
        raise exception 'Часът още тече — гратис се дава, след като времето изтече.'
            using errcode = 'P0001';
    end if;

    if v_class.grace_until is not null and v_class.grace_until > v_class.joining_open_until then
        raise exception 'Вече даде гратис за този час.' using errcode = 'P0001';
    end if;

    update public.classes
       set grace_until = now() + public.grace_period()
     where id = p_class_id
    returning * into v_class;

    return v_class;
end;
$$;

-- -----------------------------------------------------------------------------
--  Състоянието на часа — за таблото на учителя.
-- -----------------------------------------------------------------------------
create or replace function public.class_lesson_state(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class        public.classes;
    v_phase        text;
    v_seconds      int;
    v_playing      int;
    v_grace_used   boolean;
begin
    if not public.is_class_owner(p_class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    select * into v_class from public.classes where id = p_class_id;

    v_grace_used := v_class.grace_until is not null
                    and v_class.grace_until > v_class.joining_open_until;

    -- Деца с незавършен опит, започнат в рамките на текущия час.
    select count(*) into v_playing
      from public.attempts a
      join public.quizzes q on q.id = a.quiz_id
      join public.students s on s.id = a.student_id
     where s.class_id = p_class_id
       and a.finished_at is null
       and a.started_at >= coalesce(v_class.joining_open_until - interval '8 hours', now());

    if v_class.joining_open_until is null then
        v_phase := 'closed';
        v_seconds := null;
    elsif v_class.joining_open_until > now() then
        v_phase := 'open';
        v_seconds := ceil(extract(epoch from (v_class.joining_open_until - now())))::int;
    elsif v_grace_used and v_class.grace_until > now() then
        v_phase := 'grace';
        v_seconds := ceil(extract(epoch from (v_class.grace_until - now())))::int;
    else
        v_phase := 'expired';
        v_seconds := 0;
    end if;

    return jsonb_build_object(
        'phase', v_phase,
        'seconds_left', v_seconds,
        'still_playing', v_playing,
        -- Въпросът „да дам ли още 5 минути“ се показва само когато има смисъл:
        -- часът е изтекъл, гратис още не е даван и някой наистина решава.
        'can_grant_grace', v_phase = 'expired' and not v_grace_used and v_playing > 0,
        'grace_used', v_grace_used
    );
end;
$$;

-- -----------------------------------------------------------------------------
--  Крайният момент за един опит вече уважава разрешения гратис.
-- -----------------------------------------------------------------------------
create or replace function public.attempt_deadline(p_attempt_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
    select case
               when c.joining_open_until is null then a.started_at
               -- Докато САМИЯТ ЧАС тече, няма краен момент. Проверката е върху
               -- joining_open_until, а не върху class_play_until: иначе по време
               -- на гратиса щеше пак да излиза "без ограничение" и броячът на
               -- детето нямаше да тръгне.
               when c.joining_open_until > now() then null
               else public.class_play_until(c)
           end
    from public.attempts a
    join public.quizzes q on q.id = a.quiz_id
    join public.classes c on c.id = q.class_id
    where a.id = p_attempt_id;
$$;

-- -----------------------------------------------------------------------------
--  submit_answer() след изтичане вече НЕ хвърля грешка.
--
--  RAISE отменя всичко, направено от функцията — включително приключването на
--  опита един ред по-горе. Тоест резултатът се губеше точно в случая, заради
--  който беше добавен. Затова връщаме обикновен отговор с признак `expired`,
--  а браузърът показва резултата.
-- -----------------------------------------------------------------------------
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
    v_final      jsonb;
begin
    select * into v_attempt from public.attempts where id = p_attempt_id;
    if not found then
        raise exception 'Няма такъв опит.' using errcode = 'P0002';
    end if;

    perform public.assert_student_session(v_attempt.student_id);

    if v_attempt.finished_at is not null then
        return jsonb_build_object(
            'expired', true,
            'score', v_attempt.score,
            'max_score', v_attempt.max_score
        );
    end if;

    v_deadline := public.attempt_deadline(p_attempt_id);
    if v_deadline is not null and v_deadline <= now() then
        v_final := public.finish_attempt(p_attempt_id);
        return jsonb_build_object(
            'expired', true,
            'score', v_final ->> 'score',
            'max_score', v_final ->> 'max_score'
        );
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
        'expired', false,
        'is_correct', coalesce(v_is_correct, false),
        'correct_answer_id', v_correct_id,
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

grant execute on function public.submit_answer(uuid, uuid, uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
--  Редакцията е заключена и по време на гратиса — децата още решават.
-- -----------------------------------------------------------------------------
create or replace function public.assert_quiz_editable(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class public.classes;
begin
    select c.* into v_class
      from public.quizzes q
      join public.classes c on c.id = q.class_id
     where q.id = p_quiz_id;

    if found and public.class_play_until(v_class) > now() then
        raise exception 'Часът тече — изчакай да свърши, за да редактираш теста.'
            using errcode = 'P0001';
    end if;
end;
$$;

-- -----------------------------------------------------------------------------
--  Времето на часа се пипа САМО през функциите отгоре.
--
--  RLS дава на учителя UPDATE върху неговия клас — тоест върху всички колони.
--  Без това ограничение правилото „часът не се затваря по-рано“ би се
--  заобикаляло с една пряка заявка. Правата за колони са по-точният инструмент:
--  учителят пак може да преименува класа, но не и да мести часовника.
-- -----------------------------------------------------------------------------
--  ВАЖНО за реда: право върху колона НЕ може да се отнеме, докато стои право
--  върху цялата таблица. Затова първо махаме табличното UPDATE и после даваме
--  изрично само колоните, които учителят наистина променя.
revoke update on public.classes from authenticated;
grant update (name, grade, school_year, archived) on public.classes to authenticated;

grant execute on function public.class_play_until(public.classes) to authenticated;
grant execute on function public.open_class(uuid, int)            to authenticated;
grant execute on function public.grant_grace(uuid)                to authenticated;
grant execute on function public.class_lesson_state(uuid)         to authenticated;
grant execute on function public.attempt_deadline(uuid)           to authenticated;
grant execute on function public.assert_quiz_editable(uuid)       to authenticated;
