-- =============================================================================
--  QUIZ APP — обяснения към въпросите и таймер по избор
--
--  1. Всеки въпрос може да носи кратко обяснение, което детето вижда СЛЕД
--     като е отговорило. Целта е обратна връзка на момента: детето вече не
--     може да си поправи отговора, но разбира къде е сгрешило.
--
--  2. Таймерът става избор на учителя. Диктовка и задача за разсъждение не
--     търпят една и съща мярка, а часовникът пречи на по-бавните деца.
--     time_per_question = NULL означава „без ограничение във времето“.
-- =============================================================================

alter table public.questions
    add column explanation text check (length(trim(explanation)) between 1 and 500);

comment on column public.questions.explanation is
    'Обяснение, което се показва СЛЕД отговора. Връща се от submit_answer(), а НЕ от start_attempt() — иначе би могло да подскаже верния отговор предварително.';

alter table public.quizzes
    alter column time_per_question drop not null;

comment on column public.quizzes.time_per_question is
    'Секунди за въпрос. NULL означава тест без таймер.';

-- -----------------------------------------------------------------------------
--  submit_answer() вече връща и обяснението.
--
--  Важно е то да се дава точно тук, а не при стартиране на теста: обяснението
--  често издава верния отговор, а start_attempt() отива в браузъра на детето
--  преди да е отговорило.
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
        'explanation', v_question.explanation,
        'points', case when coalesce(v_is_correct, false) then v_question.points else 0 end
    );
end;
$$;

grant execute on function public.submit_answer(uuid, uuid, uuid, int) to authenticated;
