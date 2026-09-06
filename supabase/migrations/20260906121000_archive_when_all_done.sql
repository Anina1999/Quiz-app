-- =============================================================================
--  QUIZ APP — тестът чака отсъстващите
--
--  Досега нов час прибираше в архива всеки тест, който ПОНЕ ЕДНО дете е решило.
--  Това чупи най-обикновения училищен случай: две деца са болни, връщат се след
--  седмица — а тестът вече е скрит и за тях.
--
--  Новото правило: тестът отива в архива само когато ВСИЧКИ ученици в класа са
--  го решили. Дотогава стои и е достъпен точно за тези, които още не са го
--  правили (това го гарантира can_start в student_quizzes).
--
--  Учителят винаги може да архивира ръчно — например ако дете е сменило
--  училище и никога няма да реши теста.
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
     * В архива отиват само тестовете, които ЦЕЛИЯТ клас е решил.
     *
     * „not exists (ученик без завършен опит)“ е нарочно формулирано така:
     * достатъчно е едно болно дете да не е решавало, за да остане тестът
     * достъпен. Упражненията се пропускат — те никога не се архивират.
     */
    update public.quizzes q
       set archived_at = now()
     where q.class_id = p_class_id
       and not q.is_practice
       and q.archived_at is null
       and exists (select 1 from public.students s where s.class_id = p_class_id)
       and not exists (
           select 1
           from public.students s
           where s.class_id = p_class_id
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
--  Кой още не е решил теста — за да го вижда учителят, преди да архивира.
-- -----------------------------------------------------------------------------
create or replace function public.quiz_progress(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_quiz     public.quizzes;
    v_total    int;
    v_finished int;
begin
    if not public.is_quiz_owner(p_quiz_id) then
        raise exception 'Нямате права над този тест.' using errcode = '42501';
    end if;

    select * into v_quiz from public.quizzes where id = p_quiz_id;

    if v_quiz.class_id is null then
        return jsonb_build_object('total', 0, 'finished', 0, 'pending', 0, 'pending_names', '[]'::jsonb);
    end if;

    select count(*) into v_total
      from public.students s where s.class_id = v_quiz.class_id;

    select count(*) into v_finished
      from public.students s
     where s.class_id = v_quiz.class_id
       and public.has_finished_attempt(s.id, p_quiz_id);

    return jsonb_build_object(
        'total', v_total,
        'finished', v_finished,
        'pending', v_total - v_finished,
        -- Псевдонимите на чакащите: учителят вижда кого да настигне.
        'pending_names', coalesce((
            select jsonb_agg(s.display_name order by coalesce(s.roll_number, 99), s.display_name)
            from public.students s
            where s.class_id = v_quiz.class_id
              and not public.has_finished_attempt(s.id, p_quiz_id)
        ), '[]'::jsonb)
    );
end;
$$;

grant execute on function public.open_class(uuid, int)   to authenticated;
grant execute on function public.quiz_progress(uuid)     to authenticated;
