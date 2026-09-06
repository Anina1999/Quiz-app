# Архитектурни решения

Указател. Всяко решение живее в собствен файл в [decisions/](decisions/) — тук
има само по един ред за него.

## Как се работи с този списък

- **Едно решение = един файл.** Номерът не се преизползва.
- Файлът има четири части: **Контекст · Решение · Последици · Отхвърлени
  алтернативи.** Ако липсва „Контекст“, решението няма да се разбере след
  година.
- Решенията **не се изтриват и не се пренаписват.** Отпаднало решение получава
  статус „заменено“ и сочи към новото. Виж [ADR-0007](decisions/0007-lesson-runs-its-course.md),
  [ADR-0013](decisions/0013-archive-only-when-all-students-finished.md) и
  [ADR-0025](decisions/0025-all-rights-reserved.md) — и трите заменят по-ранно
  правило.
- **Статуси:** `прието` (в кода е) · `предложено` (в плана, чака одобрение) ·
  `заменено` (важи наследникът) · `отхвърлено`.

## Приети — вече са в кода

| № | Решение | Област |
|---|---|---|
| [0001](decisions/0001-no-child-personal-data.md) | В базата няма лични данни на деца | лични данни |
| [0002](decisions/0002-grading-in-the-database.md) | Оценяването става в базата, не в браузъра | сигурност |
| [0003](decisions/0003-supabase-instead-of-custom-backend.md) | Supabase вместо собствен бекенд | архитектура |
| [0004](decisions/0004-hashrouter-for-github-pages.md) | HashRouter, не BrowserRouter | фронтенд |
| [0005](decisions/0005-no-third-party-requests.md) | Никакви заявки към трети страни | лични данни |
| [0006](decisions/0006-timed-joining-window.md) | Постоянен код + срочен прозорец за влизане | сигурност |
| [0007](decisions/0007-lesson-runs-its-course.md) | Часът не се удължава; гратис веднъж, от учителя | час |
| [0008](decisions/0008-optional-timer.md) | Таймерът е избор на учителя | педагогика |
| [0009](decisions/0009-two-explanations-per-question.md) | Отделно обяснение при верен и при грешен отговор | педагогика |
| [0010](decisions/0010-hint-before-answer.md) | Подсказка преди отговора, обяснение след него | педагогика |
| [0011](decisions/0011-question-bank.md) | Банка с въпроси срещу преписване | оценяване |
| [0012](decisions/0012-quiz-solved-once-practice-is-the-exception.md) | Тестът се решава веднъж; упражнението е изключението | оценяване |
| [0013](decisions/0013-archive-only-when-all-students-finished.md) | Архив едва когато всички са решили | час |
| [0014](decisions/0014-locked-editing-during-lesson.md) | Няма редакция, докато класът е отворен | час |
| [0015](decisions/0015-anon-role-has-no-privileges.md) | Децата нямат пряк достъп до таблици | сигурност |
| [0016](decisions/0016-printable-attempt-report.md) | Протоколът е страница за печат, не PDF библиотека | документация |
| [0017](decisions/0017-bundled-sql-is-generated-not-committed.md) | Слепеният SQL се генерира, не се пази в Git | процес |
| [0025](decisions/0025-all-rights-reserved.md) | Всички права запазени вместо MIT | лиценз |

## Предложени — от плана, чакат одобрение

| № | Решение | Фаза |
|---|---|---|
| [0018](decisions/0018-images-in-supabase-storage.md) | Снимките се качват в Storage, не се сочат отвън | 1 |
| [0019](decisions/0019-inline-svg-illustrations.md) | Маскот и иконки като inline SVG | 1 |
| [0020](decisions/0020-text-to-speech-for-early-readers.md) | Прочит на глас през Web Speech API | 1 |
| [0023](decisions/0023-gamification-without-comparing-children.md) | Геймификация без класация между децата | 1 |
| [0021](decisions/0021-sen-profile-per-student.md) | Диференциацията е свойство на ученика, не на теста | 2 |
| [0024](decisions/0024-progress-by-topic-not-only-subject.md) | Напредъкът се мери по тема, не само по предмет | 2 |
| [0022](decisions/0022-offline-only-for-practice.md) | Офлайн игра само за упражнение | 3 |

## Кои решения не се пипат без изричен разговор

[0001](decisions/0001-no-child-personal-data.md) ·
[0002](decisions/0002-grading-in-the-database.md) ·
[0005](decisions/0005-no-third-party-requests.md) ·
[0015](decisions/0015-anon-role-has-no-privileges.md)

Върху тях четири стъпва цялото обещание, което приложението дава на едно
училище. Всичко останало е предмет на обсъждане.
