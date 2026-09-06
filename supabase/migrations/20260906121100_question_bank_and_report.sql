-- =============================================================================
--  QUIZ APP — банка с въпроси и протокол на решен тест
--
--  1. БАНКА С ВЪПРОСИ. Учителят въвежда напр. 20 въпроса, а всяко дете получава
--     случайни 10. Снимка на екрана на съседа покрива само половината от твоя
--     тест — това е реалната защита срещу преписване, за разлика от опитите да
--     се забрани екранната снимка, каквато възможност браузърът няма.
--
--  2. ПРОТОКОЛ. Пълни данни за един решен тест, за да може учителят да го
--     разпечата или запази като PDF за документация.
-- =============================================================================

alter table public.quizzes
    add column questions_per_attempt smallint
        check (questions_per_attempt is null or questions_per_attempt >= 1);

comment on column public.quizzes.questions_per_attempt is
    'Колко въпроса получава едно дете. NULL означава всички. По-малко число превръща теста в банка с въпроси.';

/*
 * Кои въпроси е получило конкретното дете.
 *
 * Без тази колона банката е неизползваема: точките, оценяването и протоколът
 * трябва да гледат ИЗТЕГЛЕНИТЕ въпроси, а не всички в теста.
 */
alter table public.attempts
    add column question_ids uuid[];

comment on column public.attempts.question_ids is
    'Въпросите, изтеглени за този опит. NULL при стари опити — тогава важат всички въпроси на теста.';

-- -----------------------------------------------------------------------------
--  Публикуването проверява и банката.
-- -----------------------------------------------------------------------------
create or replace function public.publish_quiz(p_quiz_id uuid, p_publish boolean default true)
returns public.quizzes
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_quiz  public.quizzes;
    v_bad   record;
    v_count int;
begin
    if not public.is_quiz_owner(p_quiz_id) then
        raise exception 'Нямате права над този тест.' using errcode = '42501';
    end if;

    select * into v_quiz from public.quizzes where id = p_quiz_id;

    if p_publish then
        select count(*) into v_count from public.questions where quiz_id = p_quiz_id;
        if v_count = 0 then
            raise exception 'Тестът няма нито един въпрос.';
        end if;

        if v_quiz.questions_per_attempt is not null
           and v_quiz.questions_per_attempt > v_count then
            raise exception 'Тестът дава % въпроса на дете, а има само %. Добави още или намали броя.',
                v_quiz.questions_per_attempt, v_count;
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

        if v_quiz.class_id is null then
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
--  start_attempt() — тегли подмножество въпроси и го запомня
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
    v_ids       uuid[];
    v_max_score int;
begin
    v_student := public.assert_student_session(p_student_id);

    select * into v_class from public.classes where id = v_student.class_id;
    perform public.assert_joining_open(v_class);

    select * into v_quiz
      from public.quizzes
     where id = p_quiz_id
       and is_published
       and archived_at is null
       and class_id = v_student.class_id;

    if not found then
        raise exception 'Тестът не е достъпен за твоя клас.' using errcode = '42501';
    end if;

    if not v_quiz.is_practice and public.has_finished_attempt(p_student_id, p_quiz_id) then
        raise exception 'Вече си решил този тест. Не може да се решава втори път.'
            using errcode = 'P0001';
    end if;

    -- Тегленето е тук, а не в браузъра: иначе детето би могло да поиска
    -- всички въпроси и да си избере кои да реши.
    select array_agg(id) into v_ids
      from (
          select qn.id
          from public.questions qn
          where qn.quiz_id = p_quiz_id
          order by random()
          limit coalesce(v_quiz.questions_per_attempt, 1000)
      ) picked;

    if v_ids is null or array_length(v_ids, 1) = 0 then
        raise exception 'Тестът няма въпроси.' using errcode = 'P0002';
    end if;

    select coalesce(sum(points), 0) into v_max_score
      from public.questions where id = any(v_ids);

    insert into public.attempts (quiz_id, student_id, max_score, question_ids)
    values (p_quiz_id, p_student_id, v_max_score, v_ids)
    returning * into v_attempt;

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'quiz', jsonb_build_object(
            'id', v_quiz.id,
            'title', v_quiz.title,
            'subject', v_quiz.subject,
            'is_practice', v_quiz.is_practice,
            'time_per_question', v_quiz.time_per_question
        ),
        'max_score', v_max_score,
        'questions', coalesce((
            select jsonb_agg(
                       jsonb_build_object(
                           'id', qs.id,
                           'prompt', qs.prompt,
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
                where qn.id = any(v_ids)
            ) qs
        ), '[]'::jsonb)
    );
end;
$$;

-- -----------------------------------------------------------------------------
--  submit_answer() приема само въпрос от ИЗТЕГЛЕНИТЕ за този опит.
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
        return jsonb_build_object('expired', true,
                                  'score', v_attempt.score,
                                  'max_score', v_attempt.max_score);
    end if;

    v_deadline := public.attempt_deadline(p_attempt_id);
    if v_deadline is not null and v_deadline <= now() then
        v_final := public.finish_attempt(p_attempt_id);
        return jsonb_build_object('expired', true,
                                  'score', v_final ->> 'score',
                                  'max_score', v_final ->> 'max_score');
    end if;

    select * into v_question
      from public.questions
     where id = p_question_id and quiz_id = v_attempt.quiz_id;

    if not found then
        raise exception 'Въпросът не е от този тест.' using errcode = 'P0002';
    end if;

    -- При банка с въпроси детето е получило само част от тях.
    if v_attempt.question_ids is not null
       and not (p_question_id = any(v_attempt.question_ids)) then
        raise exception 'Този въпрос не е част от твоя тест.' using errcode = 'P0002';
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

-- =============================================================================
--  ПРОТОКОЛ на решен тест — за разпечатване или запазване като PDF
-- =============================================================================
create or replace function public.attempt_report(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.attempts;
    v_quiz    public.quizzes;
    v_student public.students;
    v_class   public.classes;
    v_ids     uuid[];
begin
    select * into v_attempt from public.attempts where id = p_attempt_id;
    if not found then
        raise exception 'Няма такъв опит.' using errcode = 'P0002';
    end if;

    if not public.is_quiz_owner(v_attempt.quiz_id) then
        raise exception 'Нямате права над този резултат.' using errcode = '42501';
    end if;

    select * into v_quiz from public.quizzes where id = v_attempt.quiz_id;
    select * into v_student from public.students where id = v_attempt.student_id;
    select * into v_class from public.classes where id = v_student.class_id;

    -- Стари опити нямат записани въпроси — тогава важат всички от теста.
    v_ids := coalesce(
        v_attempt.question_ids,
        (select array_agg(id) from public.questions where quiz_id = v_attempt.quiz_id)
    );

    return jsonb_build_object(
        'attempt', jsonb_build_object(
            'id', v_attempt.id,
            'started_at', v_attempt.started_at,
            'finished_at', v_attempt.finished_at,
            'score', v_attempt.score,
            'max_score', v_attempt.max_score
        ),
        'student', jsonb_build_object(
            'display_name', v_student.display_name,
            'roll_number', v_student.roll_number
        ),
        'class', jsonb_build_object('name', v_class.name, 'grade', v_class.grade),
        'quiz', jsonb_build_object(
            'title', v_quiz.title,
            'subject', v_quiz.subject,
            'grade', v_quiz.grade,
            'is_practice', v_quiz.is_practice
        ),
        'questions', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'prompt', qn.prompt,
                    'points', qn.points,
                    'given_answer', (select a.text from public.answers a where a.id = aa.answer_id),
                    'correct_answer', (select a.text from public.answers a
                                        where a.question_id = qn.id and a.is_correct limit 1),
                    -- NULL отговор значи изтекло време или недостигнат въпрос.
                    'answered', aa.id is not null and aa.answer_id is not null,
                    'is_correct', coalesce(aa.is_correct, false),
                    'time_taken_ms', aa.time_taken_ms
                ) order by qn.position)
            from public.questions qn
            left join public.attempt_answers aa
                   on aa.question_id = qn.id and aa.attempt_id = p_attempt_id
            where qn.id = any(v_ids)
        ), '[]'::jsonb)
    );
end;
$$;

grant execute on function public.publish_quiz(uuid, boolean)          to authenticated;
grant execute on function public.start_attempt(uuid, uuid)            to authenticated;
grant execute on function public.submit_answer(uuid, uuid, uuid, int) to authenticated;
grant execute on function public.attempt_report(uuid)                 to authenticated;
