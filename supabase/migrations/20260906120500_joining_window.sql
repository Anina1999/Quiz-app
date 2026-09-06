-- =============================================================================
--  QUIZ APP — прозорец за влизане в клас
--
--  Проблемът: кодът на класа е постоянен. Дете може да си го запише, да се
--  прибере вкъщи и вечерта — когато шестте часа са минали и псевдонимите са
--  свободни — да влезе като съученик и да му развали резултата.
--
--  Решението: влизането е разрешено само в прозорец, който учителят отваря в
--  началото на часа. Кодът остава постоянен (може да стои на плакат в стаята),
--  но сам по себе си вече не стига.
--
--  Прозорецът е СРОЧЕН, а не просто включено/изключено ключе. Ако беше ключе,
--  рано или късно ще остане вдигнато и защитата пада, без някой да забележи.
--
--  ВАЖНО: прозорецът гати САМО влизането. Дете, което вече е влязло, продължава
--  да решава спокойно, дори прозорецът да се затвори по средата на теста.
-- =============================================================================

alter table public.classes
    add column joining_open_until timestamptz;

comment on column public.classes.joining_open_until is
    'До кога е разрешено влизане в класа. NULL или минал момент означава затворено. Не засяга деца, които вече са влезли.';

-- Съществуващите класове остават затворени. Безопасната стойност по
-- подразбиране е "затворено" — учителят отваря съзнателно.

-- -----------------------------------------------------------------------------
--  Отваряне и затваряне на прозореца (само за учителя на класа)
-- -----------------------------------------------------------------------------
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
        v_until := null;                                  -- затваряме веднага
    else
        -- Таван от 8 часа: прозорец за цял ден е същото като изключена защита.
        v_until := now() + (least(p_minutes, 480) || ' minutes')::interval;
    end if;

    update public.classes set joining_open_until = v_until where id = p_class_id;
    return v_until;
end;
$$;

grant execute on function public.set_joining_window(uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
--  Проверка, ползвана от двете ученически функции
-- -----------------------------------------------------------------------------
create or replace function public.assert_joining_open(p_class public.classes)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_class.joining_open_until is null or p_class.joining_open_until <= now() then
        raise exception 'Класът не е отворен за влизане в момента. Кажи на учителя.'
            using errcode = 'P0001';
    end if;
end;
$$;

-- -----------------------------------------------------------------------------
--  class_preview() — вече отказва, ако прозорецът е затворен.
--  Списъкът с псевдонимите не бива да се вижда извън часа.
-- -----------------------------------------------------------------------------
create or replace function public.class_preview(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class public.classes;
begin
    select * into v_class
      from public.classes
     where join_code = upper(trim(p_join_code)) and not archived;

    if not found then
        raise exception 'Няма клас с този код.' using errcode = 'P0002';
    end if;

    perform public.assert_joining_open(v_class);

    return jsonb_build_object(
        'class', jsonb_build_object(
            'id', v_class.id,
            'name', v_class.name,
            'grade', v_class.grade
        ),
        'students', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', s.id,
                       'display_name', s.display_name,
                       'roll_number', s.roll_number,
                       'is_taken', s.session_uid is not null
                                   and s.session_uid is distinct from (select auth.uid())
                                   and s.session_claimed_at > now() - public.student_session_ttl()
                   ) order by coalesce(s.roll_number, 99), s.display_name)
            from public.students s
            where s.class_id = v_class.id
        ), '[]'::jsonb)
    );
end;
$$;

-- -----------------------------------------------------------------------------
--  claim_student() — същата проверка. Тук е същинската защита; class_preview
--  само не показва списъка.
-- -----------------------------------------------------------------------------
create or replace function public.claim_student(p_join_code text, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_class   public.classes;
    v_student public.students;
    v_uid     uuid := (select auth.uid());
begin
    if v_uid is null then
        raise exception 'Няма активна сесия.' using errcode = '42501';
    end if;

    select * into v_class
      from public.classes
     where join_code = upper(trim(p_join_code)) and not archived;

    if not found then
        raise exception 'Няма клас с този код.' using errcode = 'P0002';
    end if;

    perform public.assert_joining_open(v_class);

    select * into v_student
      from public.students
     where id = p_student_id and class_id = v_class.id
       for update;

    if not found then
        raise exception 'Този ученик не е в класа.' using errcode = 'P0002';
    end if;

    if v_student.session_uid is not null
       and v_student.session_uid is distinct from v_uid
       and v_student.session_claimed_at > now() - public.student_session_ttl()
    then
        raise exception 'Някой друг вече е избрал този псевдоним.' using errcode = 'P0001';
    end if;

    -- Едно устройство държи най-много един псевдоним в класа.
    update public.students
       set session_uid = null, session_claimed_at = null
     where class_id = v_class.id and session_uid = v_uid and id <> p_student_id;

    update public.students
       set session_uid = v_uid, session_claimed_at = now()
     where id = p_student_id
    returning * into v_student;

    return jsonb_build_object(
        'student', jsonb_build_object(
            'id', v_student.id,
            'display_name', v_student.display_name,
            'roll_number', v_student.roll_number
        ),
        'class', jsonb_build_object(
            'id', v_class.id,
            'name', v_class.name,
            'grade', v_class.grade,
            'join_code', v_class.join_code
        )
    );
end;
$$;

grant execute on function public.assert_joining_open(public.classes) to authenticated;
grant execute on function public.class_preview(text)               to authenticated;
grant execute on function public.claim_student(text, uuid)         to authenticated;
