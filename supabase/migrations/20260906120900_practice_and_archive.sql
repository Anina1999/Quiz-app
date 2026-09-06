-- =============================================================================
--  QUIZ APP — тест се решава веднъж; упражненията са изключението
--
--  1. Обикновен тест се решава ЕДИН ПЪТ. Ако дете предаде по-рано, не може да
--     го отвори наново — иначе оценяването губи смисъл.
--
--  2. Тест с флаг „упражнение“ може да се решава колкото пъти иска детето.
--     Там целта е трениране, не измерване.
--
--  3. При отваряне на НОВ ЧАС решените тестове отиват в архива. Така списъкът
--     на детето показва само това, което му предстои, а старите резултати
--     остават непокътнати за учителя.
-- =============================================================================

alter table public.quizzes
    add column is_practice boolean     not null default false,
    add column archived_at timestamptz;

comment on column public.quizzes.is_practice is
    'Упражнение: може да се решава многократно. Обикновеният тест — само веднъж.';

comment on column public.quizzes.archived_at is
    'Кога тестът е излязъл от употреба. Архивираните не се показват на децата, но резултатите им остават.';

create index quizzes_active_idx on public.quizzes (class_id)
    where is_published and archived_at is null;

-- -----------------------------------------------------------------------------
--  Решавал ли е вече това дете този тест (завършен опит).
-- -----------------------------------------------------------------------------
create or replace function public.has_finished_attempt(p_student_id uuid, p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.attempts a
        where a.student_id = p_student_id
          and a.quiz_id = p_quiz_id
          and a.finished_at is not null
    );
$$;

-- =============================================================================
--  Нов час архивира решените тестове
-- =============================================================================
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

    if public.class_play_until(v_class) > now() then
        raise exception 'Часът вече тече. Изчакай да свърши — времето не може да се променя.'
            using errcode = 'P0001';
    end if;

    /*
     * Новият час затваря стария. Тест, който вече е решаван, отива в архива —
     * иначе седмици по-късно децата още го виждат в списъка си.
     *
     * Упражненията се пропускат нарочно: те са за трениране и трябва да
     * остават достъпни.
     */
    update public.quizzes q
       set archived_at = now()
     where q.class_id = p_class_id
       and not q.is_practice
       and q.archived_at is null
       and exists (
           select 1 from public.attempts a
           where a.quiz_id = q.id and a.finished_at is not null
       );

    update public.classes
       set joining_open_until = now() + (least(p_minutes, 480) || ' minutes')::interval,
           grace_until = null
     where id = p_class_id
    returning * into v_class;

    return v_class;
end;
$$;

-- =============================================================================
--  start_attempt() — един опит на тест, освен при упражнение
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

    -- Същинското правило: обикновен тест се решава веднъж.
    if not v_quiz.is_practice and public.has_finished_attempt(p_student_id, p_quiz_id) then
        raise exception 'Вече си решил този тест. Не може да се решава втори път.'
            using errcode = 'P0001';
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
                where qn.quiz_id = p_quiz_id
            ) qs
        ), '[]'::jsonb)
    );
end;
$$;

-- =============================================================================
--  student_quizzes() — крие архивираните и казва кое още може да се решава
-- =============================================================================
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
                'is_practice', q.is_practice,
                'time_per_question', q.time_per_question,
                'question_count', (select count(*) from public.questions qn where qn.quiz_id = q.id),
                'attempts_count', (select count(*) from public.attempts at
                                    where at.quiz_id = q.id and at.student_id = p_student_id
                                      and at.finished_at is not null),
                'best_score', (select max(at.score) from public.attempts at
                                where at.quiz_id = q.id and at.student_id = p_student_id
                                  and at.finished_at is not null),
                'max_score', (select coalesce(sum(qn.points), 0)
                                from public.questions qn where qn.quiz_id = q.id),
                -- Упражнението може винаги; обикновеният тест — само ако още
                -- не е решен.
                'can_start', q.is_practice
                             or not public.has_finished_attempt(p_student_id, q.id)
            ) as x
            from public.quizzes q
            where q.class_id = v_student.class_id
              and q.is_published
              and q.archived_at is null
              and exists (select 1 from public.questions qn where qn.quiz_id = q.id)
        ) t
    ), '[]'::jsonb);
end;
$$;

grant execute on function public.has_finished_attempt(uuid, uuid) to authenticated;
grant execute on function public.open_class(uuid, int)            to authenticated;
grant execute on function public.start_attempt(uuid, uuid)        to authenticated;
grant execute on function public.student_quizzes(uuid)            to authenticated;
