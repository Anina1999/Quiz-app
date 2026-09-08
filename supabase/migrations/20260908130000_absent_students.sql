-- =============================================================================
--  QUIZ APP — отсъстващото дете не решава теста от вкъщи
--
--  Проблемът, който прозорецът за влизане НЕ решава: часът тече, прозорецът е
--  отворен по замисъл, а детето си е вкъщи, знае кода от дъската (съученик му
--  го е пратил за пет секунди) и решава теста заедно с класа.
--
--  Ротацията на кода не помага — кодът пътува по-бързо, отколкото се сменя.
--  Ограничение по IP не помага — Supabase не подава надеждно адреса на клиента
--  към SQL, а мобилен интернет в стаята би дал фалшив отказ.
--
--  Липсващата информация е една: КОЙ Е В СТАЯТА. Приложението няма как да я
--  знае. Учителят я знае.
--
--  ДВЕ РАЗЛИЧНИ ОТСЪСТВИЯ, защото училището има два случая:
--
--  1. ОТСЪСТВА ОТ УЧИЛИЩЕ (absent_since) — болен, за неопределено време.
--     Заключва ВСИЧКИ тестове и НЕ изтича само. Пада само когато учителят
--     отбележи връщането. Ако изтичаше на другия ден, детето щеше да е
--     „присъстващо“ по подразбиране и щеше да реши теста от леглото —
--     точно измамата, която гоним.
--
--  2. НЯМА ГО В ТОЗИ ЧАС (absent_for_lesson) — на училище е, но този час го
--     няма: при ресурсния учител, при медицинската сестра, на състезание.
--     Заключва само тестовете на ТОЗИ час. Ако следващия час пак е в клас,
--     новият тест му е достъпен.
--
--  Часът се разпознава по classes.joining_open_until: всяко open_class() дава
--  нова стойност, затова отметката за един час не важи за следващия.
--
--  Отбелязаното дете МОЖЕ да влезе в класа с кода — нищо във влизането не се
--  променя — но тестовете му са заключени и на екрана пише защо и какво следва.
--  Болно дете, което отвори приложението, трябва да получи обяснение, а не
--  „грешен код“: заключен тест с ясен надпис учи правилото, отказано влизане
--  учи, че нещо е счупено.
-- =============================================================================

alter table public.students
    add column absent_since       date,
    add column absent_for_lesson  timestamptz;

comment on column public.students.absent_since is
    'Отсъства от училище ОТ тази дата, за неопределено време. Заключва всички тестове. НЕ изтича само — пада само когато учителят отбележи връщането. NULL означава, че детето е на училище.';

comment on column public.students.absent_for_lesson is
    'Детето го няма точно в този час. Стойността е classes.joining_open_until на съответния час. Следващият час има друга стойност, затова отметката не важи за него.';

-- -----------------------------------------------------------------------------
--  Днешната дата по българско време.
--
--  Базата работи в UTC. Училищните часове не попадат в прозореца, където двете
--  дати се разминават, но отмятането не бива да зависи от това кога е правено.
-- -----------------------------------------------------------------------------
create or replace function public.school_today()
returns date
language sql
stable
set search_path = ''
as $$
    select (now() at time zone 'Europe/Sofia')::date;
$$;

-- -----------------------------------------------------------------------------
--  Заключен ли е тестът за това дете в момента, и защо.
--
--  Връща 'days' | 'lesson' | NULL. Причината пътува до детето, защото двата
--  случая искат различен текст: „когато се върнеш“ срещу „следващия път“.
-- -----------------------------------------------------------------------------
create or replace function public.absence_kind(
    p_student public.students,
    p_class   public.classes
)
returns text
language sql
stable
set search_path = ''
as $$
    select case
               when p_student.absent_since is not null then 'days'
               when p_class.joining_open_until is not null
                    and p_student.absent_for_lesson = p_class.joining_open_until
                    then 'lesson'
           end;
$$;

-- -----------------------------------------------------------------------------
--  Отсъства от училище — за неопределено време, до връщане.
-- -----------------------------------------------------------------------------
create or replace function public.set_absent(p_student_id uuid, p_absent boolean)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_student public.students;
begin
    select * into v_student from public.students where id = p_student_id;

    if not found then
        raise exception 'Няма такъв ученик.' using errcode = 'P0002';
    end if;

    if not public.is_class_owner(v_student.class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    update public.students
       set absent_since = case
                              when not p_absent then null
                              -- Датата на ПЪРВИЯ ден на отсъствието се пази:
                              -- повторно отмятане не я премества напред, за да
                              -- показва учителят колко дълго го няма детето.
                              else coalesce(v_student.absent_since, public.school_today())
                          end,
           -- Връщането в училище изчиства и отметката за отделен час — иначе
           -- дете, върнало се същия ден, би останало заключено без причина.
           absent_for_lesson = case when p_absent then v_student.absent_for_lesson end
     where id = p_student_id
    returning * into v_student;

    return v_student;
end;
$$;

comment on function public.set_absent(uuid, boolean) is
    'Отсъства от училище за неопределено време. Заключва всички тестове, докато учителят не отбележи връщането.';

-- -----------------------------------------------------------------------------
--  Няма го в ТОЗИ час — само за текущия час.
-- -----------------------------------------------------------------------------
create or replace function public.set_absent_this_lesson(p_student_id uuid, p_absent boolean)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_student public.students;
    v_class   public.classes;
begin
    select * into v_student from public.students where id = p_student_id;

    if not found then
        raise exception 'Няма такъв ученик.' using errcode = 'P0002';
    end if;

    if not public.is_class_owner(v_student.class_id) then
        raise exception 'Нямате права над този клас.' using errcode = '42501';
    end if;

    select * into v_class from public.classes where id = v_student.class_id;

    -- Няма как да отбележиш отсъствие от час, който не тече. Иначе отметката
    -- увисва към миналия час и не важи за нищо.
    if v_class.joining_open_until is null or v_class.joining_open_until <= now() then
        raise exception 'Часът не е отворен. Отбележи отсъствието, след като започне часът.'
            using errcode = 'P0001';
    end if;

    update public.students
       set absent_for_lesson = case when p_absent then v_class.joining_open_until end
     where id = p_student_id
    returning * into v_student;

    return v_student;
end;
$$;

comment on function public.set_absent_this_lesson(uuid, boolean) is
    'Детето го няма в текущия час. Заключва само неговите тестове; следващият час отваря отново.';

-- -----------------------------------------------------------------------------
--  start_attempt() отказва на отсъстващо дете.
--
--  Проверката е ТУК, в базата, а не в браузъра: детето от вкъщи има същия код
--  и същото приложение, така че скрит бутон не е защита.
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
--  Състоянието, което детето вижда: тече ли час и защо тестът е заключен.
-- -----------------------------------------------------------------------------
create or replace function public.student_lesson_state(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_student public.students;
    v_class   public.classes;
    v_absence text;
begin
    v_student := public.assert_student_session(p_student_id);

    select * into v_class from public.classes where id = v_student.class_id;

    v_absence := public.absence_kind(v_student, v_class);

    return jsonb_build_object(
        'open', v_class.joining_open_until is not null
                and v_class.joining_open_until > now(),
        'until', case
                     when v_class.joining_open_until > now()
                     then v_class.joining_open_until
                 end,
        'absent', v_absence is not null,
        -- 'days'   — отсъства от училище, до връщане
        -- 'lesson' — на училище е, но този час го няма
        'absent_kind', v_absence
    );
end;
$$;

-- -----------------------------------------------------------------------------
--  student_quizzes() — can_start отчита и двата вида отсъствие.
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
              and q.is_published
              and q.archived_at is null
              and exists (select 1 from public.questions qn where qn.quiz_id = q.id)
        ) t
    ), '[]'::jsonb);
end;
$$;

grant execute on function public.school_today()                                      to authenticated;
grant execute on function public.absence_kind(public.students, public.classes)       to authenticated;
grant execute on function public.set_absent(uuid, boolean)                           to authenticated;
grant execute on function public.set_absent_this_lesson(uuid, boolean)               to authenticated;
