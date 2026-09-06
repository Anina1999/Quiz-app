-- =============================================================================
--  QUIZ APP — отделно обяснение при верен и при грешен отговор
--
--  Досега въпросът носеше едно обяснение, а приложението слагаше различен увод
--  („Точно!“ / „Не бързай —“). На практика двата случая искат различен текст:
--  при верен отговор потвърждаваш разсъждението, при грешен показваш къде се
--  е объркало детето. Затова полетата стават две, и двете по избор.
--
--  Съществуващият текст се пренася И В ДВЕТЕ полета, за да не се загуби вече
--  написаното от учителя.
-- =============================================================================

alter table public.questions
    add column explanation_correct text check (length(trim(explanation_correct)) between 1 and 500),
    add column explanation_wrong   text check (length(trim(explanation_wrong)) between 1 and 500);

update public.questions
   set explanation_correct = explanation,
       explanation_wrong   = explanation
 where explanation is not null;

alter table public.questions drop column explanation;

comment on column public.questions.explanation_correct is
    'Показва се, когато детето отговори вярно. По избор.';

comment on column public.questions.explanation_wrong is
    'Показва се при грешен отговор И при изтекло време. По избор.';

-- -----------------------------------------------------------------------------
--  submit_answer() избира кой текст да върне.
--
--  Изборът е в базата, а не в браузъра — иначе и двата текста щяха да пътуват
--  до детето и този за грешен отговор би подсказал верния.
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
        -- При изтекло време детето не е отговорило — насоката за грешка е
        -- точно това, от което има нужда.
        'explanation', case when coalesce(v_is_correct, false)
                            then v_question.explanation_correct
                            else v_question.explanation_wrong
                       end,
        'points', case when coalesce(v_is_correct, false) then v_question.points else 0 end
    );
end;
$$;

grant execute on function public.submit_answer(uuid, uuid, uuid, int) to authenticated;
