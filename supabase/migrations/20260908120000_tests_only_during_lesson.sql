-- =============================================================================
--  QUIZ APP — тестът се решава в час, а не от вкъщи
--
--  Правилото беше в сила и досега: и claim_student(), и start_attempt() викат
--  assert_joining_open(). Дете извън час не може нито да влезе, нито да
--  стартира тест.
--
--  Пропускът беше друг — правилото се научаваше чак при удара в него.
--  student_quizzes() не гледаше прозореца на часа, а сесията на детето живее
--  6 часа (student_session_ttl) и записът в localStorage — още повече. Затова
--  дете, влязло в час, вечерта вкъщи отваряше приложението, виждаше тестовете
--  си като достъпни, натискаше — и получаваше грешка.
--
--  Тук:
--    1. can_start в student_quizzes отчита и прозореца на часа;
--    2. student_lesson_state() казва на приложението дали часът тече, за да
--       обясни на детето какво става ПРЕДИ да натисне.
--
--  Какво НЕ се променя: дете, което вече е започнало тест, го довършва дори
--  часът да свърши (виж ADR-0006 и гратиса в ADR-0007). Ограничението е върху
--  започването, не върху довършването.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  Тече ли час за класа на това дете.
--
--  Проверката е върху joining_open_until, а не върху class_play_until: през
--  гратиса се ДОВЪРШВА започнатото, но нов тест не се започва. Същото прави и
--  assert_joining_open(), затова двете не могат да се разминат.
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
begin
    v_student := public.assert_student_session(p_student_id);

    select * into v_class from public.classes where id = v_student.class_id;

    return jsonb_build_object(
        'open', v_class.joining_open_until is not null
                and v_class.joining_open_until > now(),
        -- Докога тече часът. NULL, когато е затворен — на детето не се показва
        -- кога ще се отвори, защото това решава учителят в момента.
        'until', case
                     when v_class.joining_open_until > now()
                     then v_class.joining_open_until
                 end
    );
end;
$$;

comment on function public.student_lesson_state(uuid) is
    'Тече ли час за класа на това дете. Приложението го пита, за да покаже „Часът не е започнал“ вместо да остави детето да натисне тест и да получи грешка.';

-- -----------------------------------------------------------------------------
--  student_quizzes() — can_start вече отчита и прозореца на часа.
--
--  Дублира проверката в start_attempt() нарочно: базата отказва, каквото и да
--  прати браузърът, а списъкът само показва честно какво ще стане. Ако едното
--  се промени някой ден, другото трябва да го последва.
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
              and v_class.joining_open_until > now();

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
                -- Извън час не се започва нищо — нито тест, нито упражнение.
                -- Иначе упражнението би било вратичка към решаване от вкъщи.
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

grant execute on function public.student_lesson_state(uuid) to authenticated;
