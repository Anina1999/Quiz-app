-- =============================================================================
--  QUIZ APP — архивът прескача отсъстващите
--
--  ADR-0013 постанови: тестът отива в архива само когато ВСИЧКИ са го решили.
--  Причината беше вярна — две болни деца не бива да губят теста си. Но при
--  дълго отсъствие правилото се обръща срещу класа: едно дете, което го няма
--  три седмици, задържа решения тест в списъка на другите деветнайсет.
--
--  Проблемът е, че `archived_at` е ЕДНО флагче за целия тест: архивиран значи
--  скрит за всички. Затова досега имаше само две състояния — или всички го
--  виждат, или никой.
--
--  Тук ги разделяме:
--
--    * АВТОМАТИЧЕН архив (`auto_archived = true`) — тестът е свършил работа за
--      класа. Скрива се от децата, КОИТО ГО СА РЕШИЛИ. Дете, което не го е
--      решило, продължава да го вижда и да може да го реши.
--
--    * РЪЧЕН архив (`auto_archived = false`) — учителят изрично изважда теста
--      от употреба („сгрешен е“, „не ни трябва“). Скрива се от ВСИЧКИ. Това е
--      твърдата спирачка и тя остава.
--
--  И понеже автоматичният архив вече не отнема теста на никого, той може да
--  тръгне по-рано: щом го решат всички, които НЕ са отбелязани като
--  отсъстващи.
-- =============================================================================

alter table public.quizzes
    add column auto_archived boolean not null default false;

comment on column public.quizzes.auto_archived is
    'true = архивиран автоматично, защото класът го е решил. Такъв тест продължава да се вижда от децата, които още не са го решили. false при ръчен архив от учителя — той скрива теста за всички.';

-- Заварените архивирани тестове се броят за автоматични: досега архивирането
-- ставаше само когато целият клас е решил, тоест по същата причина.
update public.quizzes
   set auto_archived = true
 where archived_at is not null;

-- -----------------------------------------------------------------------------
--  Вижда ли това дете този тест.
--
--  Едно място за правилото, защото го ползват и списъкът, и стартирането. Ако
--  се разминат, детето вижда тест, който не може да започне — или обратното.
-- -----------------------------------------------------------------------------
create or replace function public.quiz_visible_to(p_quiz public.quizzes, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_quiz.is_published
       and (
           p_quiz.archived_at is null
           -- Автоматично архивираният тест остава за онзи, който не го е решил:
           -- точно случаят на дълго отсъстващото дете.
           or (p_quiz.auto_archived
               and not public.has_finished_attempt(p_student_id, p_quiz.id))
       );
$$;

-- -----------------------------------------------------------------------------
--  open_class() — архивът чака само присъстващите.
-- -----------------------------------------------------------------------------
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
     * В архива отиват тестовете, решени от всички, които НЕ отсъстват.
     *
     * Отсъстващото дете се пропуска при броенето, но НЕ губи теста: за него
     * `quiz_visible_to` го оставя видим, защото не го е решило. Така списъкът
     * на класа се изчиства, а болното дете наваксва, когато се върне.
     *
     * Упражненията се пропускат — те никога не се архивират.
     */
    update public.quizzes q
       set archived_at = now(),
           auto_archived = true
     where q.class_id = p_class_id
       and not q.is_practice
       and q.archived_at is null
       and exists (
           select 1 from public.students s
           where s.class_id = p_class_id and s.absent_since is null
       )
       and not exists (
           select 1
           from public.students s
           where s.class_id = p_class_id
             and s.absent_since is null
             and not public.has_finished_attempt(s.id, q.id)
       );

    update public.classes
       set joining_open_until = now() + (least(p_minutes, 480) || ' minutes')::interval,
           grace_until = null
     where id = p_class_id
    returning * into v_class;

    return v_class;
end;
$$;

-- -----------------------------------------------------------------------------
--  student_quizzes() — показва и автоматично архивираните нерешени тестове.
-- -----------------------------------------------------------------------------
create or replace function public.student_quizzes(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_student public.students;
    v_class   public.classes;
    v_open    boolean;
begin
    v_student := public.assert_student_session(p_student_id);

    select * into v_class from public.classes where id = v_student.class_id;

    v_open := v_class.joining_open_until is not null
              and v_class.joining_open_until > now()
              and public.absence_kind(v_student, v_class) is null;

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
                'can_start', v_open
                             and (q.is_practice
                                  or not public.has_finished_attempt(p_student_id, q.id))
            ) as x
            from public.quizzes q
            where q.class_id = v_student.class_id
              and public.quiz_visible_to(q, p_student_id)
              and exists (select 1 from public.questions qn where qn.quiz_id = q.id)
        ) t
    ), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
--  start_attempt() — същото правило за видимост, за да няма разминаване.
-- -----------------------------------------------------------------------------
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
    v_absence   text;
    v_ids       uuid[];
    v_max_score int;
begin
    v_student := public.assert_student_session(p_student_id);

    select * into v_class from public.classes where id = v_student.class_id;
    perform public.assert_joining_open(v_class);

    v_absence := public.absence_kind(v_student, v_class);

    if v_absence = 'days' then
        raise exception 'Отбелязан си като отсъстващ. Ще решиш теста, когато се върнеш в клас.'
            using errcode = 'P0001';
    elsif v_absence = 'lesson' then
        raise exception 'Този час не си в клас. Тестът те чака за следващия път.'
            using errcode = 'P0001';
    end if;

    select * into v_quiz
      from public.quizzes
     where id = p_quiz_id
       and class_id = v_student.class_id;

    if not found or not public.quiz_visible_to(v_quiz, p_student_id) then
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

grant execute on function public.quiz_visible_to(public.quizzes, uuid) to authenticated;
