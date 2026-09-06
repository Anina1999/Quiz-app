import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from '../api/index.js';
import { SUBJECTS, classOptions, gradeOptions } from '../lib/constants.js';
import { useAsync } from '../hooks/useAsync.js';
import { useFeedback } from '../hooks/useFeedback.js';
import { BackLink, Feedback, Loading, QuizBadge, SelectField, TextField } from '../components/ui.jsx';
import { QuestionForm, emptyDraft, toDraft } from '../components/QuestionForm.jsx';

/** Стойността по подразбиране, ако учителят включи таймера. */
const DEFAULT_SECONDS = 20;

export default function QuizEditor() {
    const { quizId } = useParams();
    const navigate = useNavigate();
    const feedback = useFeedback();

    const { data, loading, error, reload, setData } = useAsync(
        async () => ({
            quiz: await api.quizzes.get(quizId),
            classes: await api.classes.list(),
            questions: await api.quizzes.listQuestions(quizId),
            progress: await api.quizzes.progress(quizId),
        }),
        [quizId]
    );

    const [draft, setDraft] = useState(emptyDraft);

    // Кой въпрос се редактира в момента (id) и неговата чернова.
    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);

    if (loading) return <Loading />;
    if (!data) return <Feedback error={error || 'Тестът не е намерен.'} />;

    const { quiz, classes, questions, progress } = data;

    /*
     * Докато класът е отворен за влизане, тестът не се редактира. Иначе едно
     * дете отговаря на един въпрос, а съученикът му — на променения.
     * Забраната е в базата (тригери), тук само не показваме формите, за да не
     * се стига до грешка.
     */
    const quizClass = classes.find((c) => c.id === quiz.class_id);
    const locked = api.classes.isJoiningOpen(quizClass);

    /** Локална промяна веднага, запис в базата след това. */
    const patchQuiz = (patch) => setData({ ...data, quiz: { ...quiz, ...patch } });

    async function saveQuiz(patch) {
        patchQuiz(patch);
        const { ok, result } = await feedback.act(() => api.quizzes.update(quizId, patch));
        if (ok) setData({ ...data, quiz: result });
    }

    async function addQuestion(e) {
        e.preventDefault();
        // Същите правила важат и в базата (publish_quiz) — тук съобщението е
        // веднага, без обиколка до сървъра.
        const { error: invalid, answers } = api.quizzes.validateQuestionDraft(draft);
        if (invalid) return feedback.setError(invalid);

        const { ok } = await feedback.act(
            () =>
                api.quizzes.addQuestion({
                    quizId,
                    prompt: draft.prompt,
                    hint: draft.hint,
                    headlines: { correct: draft.headline_correct, wrong: draft.headline_wrong },
                    explanations: { correct: draft.explanation_correct, wrong: draft.explanation_wrong },
                    position: questions.length,
                    answers,
                }),
            'Въпросът е добавен.'
        );
        if (ok) {
            setDraft(emptyDraft());
            reload();
        }
    }

    function startEditing(question) {
        setEditingId(question.id);
        setEditDraft(toDraft(question));
        feedback.clear();
    }

    function cancelEditing() {
        setEditingId(null);
        setEditDraft(null);
    }

    async function saveQuestion(e) {
        e.preventDefault();

        const { error: invalid, answers } = api.quizzes.validateQuestionDraft(editDraft);
        if (invalid) return feedback.setError(invalid);

        const { ok } = await feedback.act(
            () =>
                api.quizzes.updateQuestion({
                    questionId: editingId,
                    prompt: editDraft.prompt,
                    hint: editDraft.hint,
                    headlines: { correct: editDraft.headline_correct, wrong: editDraft.headline_wrong },
                    explanations: { correct: editDraft.explanation_correct, wrong: editDraft.explanation_wrong },
                    answers,
                }),
            'Въпросът е обновен.'
        );
        if (ok) {
            cancelEditing();
            reload();
        }
    }

    async function removeQuestion(id) {
        if (!window.confirm('Да изтрия ли този въпрос?')) return;
        const { ok } = await feedback.act(() => api.quizzes.removeQuestion(id));
        if (ok) reload();
    }

    async function togglePublish() {
        const { ok, result } = await feedback.act(() =>
            api.quizzes.publish(quizId, !quiz.is_published)
        );
        if (ok) {
            setData({ ...data, quiz: result });
            feedback.setNotice(
                result.is_published
                    ? 'Тестът е публикуван — децата вече го виждат.'
                    : 'Тестът е скрит от учениците.'
            );
        }
    }

    async function removeQuiz() {
        if (!window.confirm('Да изтрия ли целия тест заедно с резултатите?')) return;
        const { ok } = await feedback.act(() => api.quizzes.remove(quizId));
        if (ok) navigate('/teacher');
    }

    return (
        <div className="page stack">
            <BackLink />

            <div className="row row--between">
                <h1>{quiz.title}</h1>
                <QuizBadge quiz={quiz} />
            </div>

            <Feedback error={error || feedback.error} notice={feedback.notice} />

            {locked && (
                <p className="alert alert--info">
                    <strong>Часът тече.</strong> Класът {quizClass.grade}. „{quizClass.name}“ е отворен за
                    влизане, затова тестът не може да се променя — децата вече го решават. Затвори класа
                    от страницата му, за да редактираш. Публикуването и скриването остават възможни.
                </p>
            )}

            <section className="card stack">
                <h2>Настройки</h2>

                <TextField
                    disabled={locked}
                    label="Заглавие"
                    value={quiz.title}
                    onChange={(e) => patchQuiz({ title: e.target.value })}
                    onBlur={(e) => saveQuiz({ title: e.target.value.trim() })}
                    minLength={2}
                    maxLength={120}
                />

                <div className="row">
                    <SelectField
                        disabled={locked}
                        label="Предмет"
                        style={{ flex: '2 1 220px' }}
                        options={SUBJECTS}
                        value={quiz.subject}
                        onChange={(e) => saveQuiz({ subject: e.target.value })}
                    />
                    <SelectField
                        disabled={locked}
                        label="Клас"
                        style={{ flex: '1 1 110px' }}
                        options={gradeOptions()}
                        value={quiz.grade}
                        onChange={(e) => saveQuiz({ grade: Number(e.target.value) })}
                    />
                    <SelectField
                        disabled={locked}
                        label="За кой клас"
                        style={{ flex: '2 1 200px' }}
                        options={classOptions(classes)}
                        value={quiz.class_id ?? ''}
                        onChange={(e) => saveQuiz({ class_id: e.target.value || null })}
                    />
                    {/* Полето за секунди се появява само ако таймерът е включен. */}
                    {quiz.time_per_question !== null && (
                        <TextField
                            disabled={locked}
                            label="Време за въпрос"
                            hint="секунди"
                            style={{ flex: '1 1 160px' }}
                            type="number"
                            min="5"
                            max="300"
                            value={quiz.time_per_question}
                            onChange={(e) => patchQuiz({ time_per_question: e.target.value })}
                            onBlur={(e) => saveQuiz({ time_per_question: Number(e.target.value) })}
                        />
                    )}
                </div>

                <label className="row" style={{ gap: 10 }}>
                    <input
                        type="checkbox"
                        disabled={locked}
                        checked={quiz.time_per_question !== null}
                        onChange={(e) =>
                            saveQuiz({ time_per_question: e.target.checked ? DEFAULT_SECONDS : null })
                        }
                    />
                    <span>
                        Ограничено време за всеки въпрос
                        <span className="field__hint">
                            Изключи го при диктовка или задача за разсъждение — часовникът пречи на
                            по-бавните деца.
                        </span>
                    </span>
                </label>

                <label className="row" style={{ gap: 10 }}>
                    <input
                        type="checkbox"
                        disabled={locked}
                        checked={quiz.shuffle_questions}
                        onChange={(e) => saveQuiz({ shuffle_questions: e.target.checked })}
                    />
                    <span>Разбърквай въпросите на всяко дете</span>
                </label>

                {/* Банка с въпроси: всяко дете тегли различно подмножество,
                    затова снимка на чужд екран покрива само част от твоя тест. */}
                <div className="row">
                    <TextField
                        disabled={locked}
                        label="Въпроси на дете"
                        hint={`от общо ${questions.length}; празно = всички`}
                        style={{ flex: '1 1 200px', maxWidth: 260 }}
                        type="number"
                        min="1"
                        max={Math.max(questions.length, 1)}
                        value={quiz.questions_per_attempt ?? ''}
                        onChange={(e) => patchQuiz({ questions_per_attempt: e.target.value })}
                        onBlur={(e) =>
                            saveQuiz({
                                questions_per_attempt: e.target.value ? Number(e.target.value) : null,
                            })
                        }
                    />
                </div>
                {quiz.questions_per_attempt && quiz.questions_per_attempt < questions.length && (
                    <p className="alert alert--ok">
                        Всяко дете получава <strong>{quiz.questions_per_attempt}</strong> случайни въпроса
                        от {questions.length}. Така съседите решават различни тестове.
                    </p>
                )}

                <label className="row" style={{ gap: 10 }}>
                    <input
                        type="checkbox"
                        disabled={locked}
                        checked={quiz.is_practice}
                        onChange={(e) => saveQuiz({ is_practice: e.target.checked })}
                    />
                    <span>
                        Тест за упражнение
                        <span className="field__hint">
                            Може да се решава многократно и не отива в архива при нов час. Обикновеният тест
                            се решава само веднъж — дете, което е предало, не може да го отвори наново.
                        </span>
                    </span>
                </label>
            </section>

            <section className="stack">
                <h2>Въпроси ({questions.length})</h2>
                {questions.length === 0 && <p className="muted">Още няма въпроси.</p>}

                <ol className="stack" style={{ paddingLeft: '1.2em' }}>
                    {questions.map((q) =>
                        editingId === q.id ? (
                            <li key={q.id}>
                                <QuestionForm
                                    formId={q.id}
                                    draft={editDraft}
                                    onChange={setEditDraft}
                                    onSubmit={saveQuestion}
                                    onCancel={cancelEditing}
                                    busy={feedback.busy}
                                    submitLabel="Запази промените"
                                />
                            </li>
                        ) : (
                            <li key={q.id} className="card stack">
                                <div className="row row--between">
                                    <strong>{q.prompt}</strong>
                                    <div className="row" style={{ gap: 8 }}>
                                        <button
                                            type="button"
                                            className="btn btn--quiet"
                                            disabled={locked}
                                            onClick={() => startEditing(q)}
                                        >
                                            Редактирай
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn--quiet"
                                            disabled={locked}
                                            onClick={() => removeQuestion(q.id)}
                                        >
                                            Изтрий
                                        </button>
                                    </div>
                                </div>
                                <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                                    {q.answers.map((a) => (
                                        <li
                                            key={a.id}
                                            style={a.is_correct ? { color: 'var(--ok)' } : undefined}
                                        >
                                            {a.is_correct ? '✓ ' : '• '}
                                            {a.text}
                                            {a.is_correct && (
                                                <span className="sr-only"> (верен отговор)</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                                {q.hint && (
                                    <p className="small muted" style={{ margin: 0 }}>
                                        💬 {q.hint}
                                    </p>
                                )}
                                {q.explanation_correct && (
                                    <p className="small muted" style={{ margin: 0 }}>
                                        ✓ {q.explanation_correct}
                                    </p>
                                )}
                                {q.explanation_wrong && (
                                    <p className="small muted" style={{ margin: 0 }}>
                                        ✗ {q.explanation_wrong}
                                    </p>
                                )}
                                {!q.explanation_correct && !q.explanation_wrong && (
                                    <p className="small muted" style={{ margin: 0 }}>
                                        Без обяснения — натисни „Редактирай“, за да добавиш.
                                    </p>
                                )}
                            </li>
                        )
                    )}
                </ol>

                {!locked && (
                    <>
                        <h3>Нов въпрос</h3>
                        <QuestionForm
                            formId="new"
                            draft={draft}
                            onChange={setDraft}
                            onSubmit={addQuestion}
                            busy={feedback.busy}
                            submitLabel="Добави въпроса"
                        />
                    </>
                )}
            </section>

            {/* Кой още не е решил теста. Тестът се архивира сам чак когато
                всички са го направили — затова е важно да се вижда кого чака. */}
            {quiz.is_published && !quiz.archived_at && !quiz.is_practice && progress.total > 0 && (
                <section className="card stack">
                    <h2>Кой е решил теста</h2>
                    <p>
                        <strong>
                            {progress.finished} от {progress.total}
                        </strong>{' '}
                        ученици.
                    </p>
                    {progress.pending > 0 ? (
                        <p className="alert alert--info">
                            Още не са решавали: <strong>{progress.pending_names.join(', ')}</strong>.
                            <br />
                            Тестът остава достъпен за тях — включително след дни, когато се върнат.
                            Останалите го виждат като решен и не могат да го отворят пак. В архива ще
                            влезе сам, когато всички го решат.
                        </p>
                    ) : (
                        <p className="alert alert--ok">
                            Всички са решили теста. При следващия отворен час ще влезе в архива.
                        </p>
                    )}
                </section>
            )}

            <section className="card stack">
                {quiz.archived_at && (
                    <p className="alert alert--info">
                        <strong>Тестът е в архива.</strong> Децата вече не го виждат — прибра се там при
                        отварянето на нов час. Резултатите остават запазени. Ако го върнеш, ще е достъпен
                        само за децата, които още не са го решавали; за повторно решаване от всички
                        отбележи го като упражнение.
                    </p>
                )}
                <div className="row">
                    <button type="button" className="btn" onClick={togglePublish}>
                        {quiz.is_published ? 'Скрий от учениците' : 'Публикувай за класа'}
                    </button>
                    <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() =>
                            feedback.act(
                                async () => {
                                    const next = quiz.archived_at
                                        ? await api.quizzes.unarchive(quizId)
                                        : await api.quizzes.archive(quizId);
                                    setData({ ...data, quiz: next });
                                },
                                quiz.archived_at ? 'Тестът е върнат от архива.' : 'Тестът е в архива.'
                            )
                        }
                    >
                        {quiz.archived_at ? 'Върни от архива' : 'В архива'}
                    </button>
                    <button type="button" className="btn btn--danger" onClick={removeQuiz}>
                        Изтрий теста
                    </button>
                </div>
            </section>
        </div>
    );
}
