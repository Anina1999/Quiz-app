-- =============================================================================
--  QUIZ APP — Row Level Security
--
--  Модел на достъпа:
--    * Учител (authenticated, с email)  -> вижда и променя САМО своите класове,
--                                          ученици, тестове и резултати.
--    * Ученик (анонимна сесия)          -> НЯМА пряк достъп до нито една таблица.
--                                          Целият ученически поток минава през
--                                          SECURITY DEFINER функции (виж
--                                          миграция ..._student_api.sql).
--
--  Така anon ключът в браузъра не може да изброи класове, да прочете верните
--  отговори или да види чужди резултати.
-- =============================================================================

alter table public.teachers        enable row level security;
alter table public.classes         enable row level security;
alter table public.students        enable row level security;
alter table public.quizzes         enable row level security;
alter table public.questions       enable row level security;
alter table public.answers         enable row level security;
alter table public.attempts        enable row level security;
alter table public.attempt_answers enable row level security;

-- -----------------------------------------------------------------------------
-- Помощни функции (SECURITY DEFINER, за да не се получи рекурсия в политиките)
-- -----------------------------------------------------------------------------
create or replace function public.is_class_owner(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.classes c
        where c.id = p_class_id and c.teacher_id = (select auth.uid())
    );
$$;

create or replace function public.is_quiz_owner(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.quizzes q
        where q.id = p_quiz_id and q.teacher_id = (select auth.uid())
    );
$$;

create or replace function public.is_question_owner(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.questions qn
        join public.quizzes q on q.id = qn.quiz_id
        where qn.id = p_question_id and q.teacher_id = (select auth.uid())
    );
$$;

-- -----------------------------------------------------------------------------
-- teachers
-- -----------------------------------------------------------------------------
create policy teachers_select_own on public.teachers
    for select to authenticated
    using (id = (select auth.uid()));

-- Умишлено НЯМА INSERT политика: профил на учител се създава единствено от
-- тригера handle_new_teacher() при регистрация с email. Така анонимна
-- ученическа сесия не може да си "изпише" учителски профил — а без ред в
-- teachers външният ключ ѝ пречи да създаде клас или тест.

create policy teachers_update_own on public.teachers
    for update to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- classes
-- -----------------------------------------------------------------------------
create policy classes_select_own on public.classes
    for select to authenticated
    using (teacher_id = (select auth.uid()));

create policy classes_insert_own on public.classes
    for insert to authenticated
    with check (teacher_id = (select auth.uid()));

create policy classes_update_own on public.classes
    for update to authenticated
    using (teacher_id = (select auth.uid()))
    with check (teacher_id = (select auth.uid()));

create policy classes_delete_own on public.classes
    for delete to authenticated
    using (teacher_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- students
-- -----------------------------------------------------------------------------
create policy students_select_own_class on public.students
    for select to authenticated
    using (public.is_class_owner(class_id));

create policy students_insert_own_class on public.students
    for insert to authenticated
    with check (public.is_class_owner(class_id));

create policy students_update_own_class on public.students
    for update to authenticated
    using (public.is_class_owner(class_id))
    with check (public.is_class_owner(class_id));

create policy students_delete_own_class on public.students
    for delete to authenticated
    using (public.is_class_owner(class_id));

-- -----------------------------------------------------------------------------
-- quizzes
-- -----------------------------------------------------------------------------
create policy quizzes_select_own on public.quizzes
    for select to authenticated
    using (teacher_id = (select auth.uid()));

create policy quizzes_insert_own on public.quizzes
    for insert to authenticated
    with check (teacher_id = (select auth.uid()));

create policy quizzes_update_own on public.quizzes
    for update to authenticated
    using (teacher_id = (select auth.uid()))
    with check (teacher_id = (select auth.uid()));

create policy quizzes_delete_own on public.quizzes
    for delete to authenticated
    using (teacher_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- questions
-- -----------------------------------------------------------------------------
create policy questions_all_own on public.questions
    for all to authenticated
    using (public.is_quiz_owner(quiz_id))
    with check (public.is_quiz_owner(quiz_id));

-- -----------------------------------------------------------------------------
-- answers
-- -----------------------------------------------------------------------------
create policy answers_all_own on public.answers
    for all to authenticated
    using (public.is_question_owner(question_id))
    with check (public.is_question_owner(question_id));

-- -----------------------------------------------------------------------------
-- attempts / attempt_answers — учителят чете, но не пише резултати.
-- Записването става само през ученическите SECURITY DEFINER функции.
-- -----------------------------------------------------------------------------
create policy attempts_select_own_quiz on public.attempts
    for select to authenticated
    using (public.is_quiz_owner(quiz_id));

create policy attempts_delete_own_quiz on public.attempts
    for delete to authenticated
    using (public.is_quiz_owner(quiz_id));

create policy attempt_answers_select_own_quiz on public.attempt_answers
    for select to authenticated
    using (exists (
        select 1 from public.attempts a
        where a.id = attempt_id and public.is_quiz_owner(a.quiz_id)
    ));

-- =============================================================================
--  Автоматично създаване на профил на учител при регистрация.
--  Анонимните ученически сесии нямат email и се пропускат.
-- =============================================================================
create or replace function public.handle_new_teacher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
begin
    -- Анонимните сесии (учениците) нямат email -> не създаваме профил на учител.
    if new.email is null or trim(new.email) = '' then
        return new;
    end if;

    v_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
    if v_name is null or length(v_name) < 2 then
        v_name := split_part(new.email, '@', 1);
    end if;
    if length(v_name) < 2 then
        v_name := 'Учител';
    end if;

    insert into public.teachers (id, email, full_name, school)
    values (
        new.id,
        new.email,
        left(v_name, 120),
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'school', '')), '')
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_teacher();
