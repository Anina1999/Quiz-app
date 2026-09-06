-- =============================================================================
--  QUIZ APP — основна схема
--  Образователен инструмент за ученици от I до IV клас (6–10 г.)
--
--  ПРИНЦИП ЗА ЗАЩИТА НА ЛИЧНИТЕ ДАННИ:
--  В базата НЕ се съхраняват лични данни на деца. Учениците се идентифицират
--  само с псевдоним и (по избор) номер в дневника. Връзката
--  "псевдоним -> конкретно дете" остава офлайн, при учителя.
--  Само учителят има акаунт с email.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- teachers — профил на учителя, 1:1 с auth.users
-- -----------------------------------------------------------------------------
create table public.teachers (
    id          uuid primary key references auth.users (id) on delete cascade,
    email       text        not null,
    full_name   text        not null check (length(trim(full_name)) between 2 and 120),
    school      text        check (length(school) <= 200),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.teachers is
    'Профил на учител. Единственият тип потребител с реални лични данни.';

-- -----------------------------------------------------------------------------
-- classes — паралелка, притежавана от учител
-- -----------------------------------------------------------------------------
create table public.classes (
    id           uuid primary key default gen_random_uuid(),
    teacher_id   uuid        not null references public.teachers (id) on delete cascade,
    name         text        not null check (length(trim(name)) between 1 and 40),
    grade        smallint    not null check (grade between 1 and 4),
    join_code    text        not null unique check (join_code ~ '^[A-Z2-9]{6}$'),
    school_year  text        check (school_year ~ '^[0-9]{4}/[0-9]{4}$'),
    archived     boolean     not null default false,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index classes_teacher_id_idx on public.classes (teacher_id);

comment on column public.classes.join_code is
    'Шестзначен код, който учителят пише на дъската. Азбуката е без 0/O/1/I/L, за да не се бърка от малки деца.';

-- -----------------------------------------------------------------------------
-- students — САМО псевдоним. Без имена, без email, без дата на раждане.
-- -----------------------------------------------------------------------------
create table public.students (
    id                 uuid primary key default gen_random_uuid(),
    class_id           uuid        not null references public.classes (id) on delete cascade,
    display_name       text        not null check (length(trim(display_name)) between 1 and 30),
    roll_number        smallint    check (roll_number between 1 and 40),
    -- анонимната Supabase сесия, която в момента "държи" този псевдоним
    session_uid        uuid,
    session_claimed_at timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (class_id, display_name),
    unique (class_id, roll_number)
);

create index students_class_id_idx on public.students (class_id);
create index students_session_uid_idx on public.students (session_uid);

comment on table public.students is
    'Ученик, представен САМО с псевдоним/номер. Тук умишлено няма колони за име, фамилия, email или дата на раждане — приложението не събира лични данни на непълнолетни.';

-- -----------------------------------------------------------------------------
-- quizzes / questions / answers — съдържание, създадено от учителя
-- -----------------------------------------------------------------------------
create table public.quizzes (
    id                uuid primary key default gen_random_uuid(),
    teacher_id        uuid        not null references public.teachers (id) on delete cascade,
    class_id          uuid        references public.classes (id) on delete set null,
    title             text        not null check (length(trim(title)) between 2 and 120),
    subject           text        not null check (subject in (
                          'Математика',
                          'Български език и литература',
                          'Околен свят',
                          'Човекът и природата',
                          'Човекът и обществото',
                          'Английски език',
                          'Друго')),
    grade             smallint    not null check (grade between 1 and 4),
    time_per_question smallint    not null default 20 check (time_per_question between 5 and 300),
    shuffle_questions boolean     not null default true,
    is_published      boolean     not null default false,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index quizzes_teacher_id_idx on public.quizzes (teacher_id);
create index quizzes_class_published_idx on public.quizzes (class_id) where is_published;

create table public.questions (
    id        uuid primary key default gen_random_uuid(),
    quiz_id   uuid     not null references public.quizzes (id) on delete cascade,
    prompt    text     not null check (length(trim(prompt)) between 1 and 500),
    image_url text     check (image_url ~ '^https://'),
    position  smallint not null check (position >= 0),
    points     smallint not null default 1 check (points between 1 and 10),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index questions_quiz_id_idx on public.questions (quiz_id, position);

create table public.answers (
    id          uuid primary key default gen_random_uuid(),
    question_id uuid     not null references public.questions (id) on delete cascade,
    text        text     not null check (length(trim(text)) between 1 and 200),
    is_correct  boolean  not null default false,
    position    smallint not null check (position >= 0),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index answers_question_id_idx on public.answers (question_id, position);

comment on column public.answers.is_correct is
    'НЕ се изпраща към браузъра на ученика. Проверката става изцяло в базата през submit_answer(), за да не може верният отговор да се прочете предварително.';

-- -----------------------------------------------------------------------------
-- attempts / attempt_answers — резултати и напредък
-- -----------------------------------------------------------------------------
create table public.attempts (
    id          uuid primary key default gen_random_uuid(),
    quiz_id     uuid        not null references public.quizzes (id) on delete cascade,
    student_id  uuid        not null references public.students (id) on delete cascade,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    score       int         not null default 0 check (score >= 0),
    max_score   int         not null default 0 check (max_score >= 0)
);

create index attempts_student_idx on public.attempts (student_id, started_at desc);
create index attempts_quiz_idx on public.attempts (quiz_id);

create table public.attempt_answers (
    id            uuid primary key default gen_random_uuid(),
    attempt_id    uuid        not null references public.attempts (id) on delete cascade,
    question_id   uuid        not null references public.questions (id) on delete cascade,
    -- NULL означава "времето изтече, детето не отговори"
    answer_id     uuid        references public.answers (id) on delete set null,
    is_correct    boolean     not null default false,
    time_taken_ms int         check (time_taken_ms >= 0),
    answered_at   timestamptz not null default now(),
    unique (attempt_id, question_id)
);

create index attempt_answers_attempt_idx on public.attempt_answers (attempt_id);

-- -----------------------------------------------------------------------------
-- updated_at — поддържа се автоматично от базата на всеки UPDATE.
--
-- Нарочно е тригер, а не задължение на приложението: така стойността е вярна
-- независимо дали редът е променен от React приложението, от SQL editor-а или
-- от бъдещ импорт на въпроси.
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array['teachers', 'classes', 'students', 'quizzes', 'questions', 'answers']
    loop
        execute format(
            'create trigger %I before update on public.%I
                 for each row execute function public.touch_updated_at()',
            t || '_touch_updated_at', t
        );
    end loop;
end;
$$;
