import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api/index.js';
import { useAuth } from '../lib/auth.jsx';
import { GRADES, SUBJECTS, classOptions, gradeOptions } from '../lib/constants.js';
import { useAsync } from '../hooks/useAsync.js';
import { useFeedback } from '../hooks/useFeedback.js';
import { Feedback, Loading, QuizBadge, SelectField, TextField } from '../components/ui.jsx';

export default function TeacherDashboard() {
    const { teacher } = useAuth();
    const navigate = useNavigate();
    const feedback = useFeedback();

    const { data, loading, error, reload } = useAsync(
        async () => ({
            classes: await api.classes.list(),
            quizzes: await api.quizzes.list(),
        }),
        []
    );

    const [classDraft, setClassDraft] = useState({ name: '', grade: 1 });
    const [quizDraft, setQuizDraft] = useState({
        title: '',
        subject: SUBJECTS[0],
        grade: 1,
        classId: '',
    });

    if (loading) return <Loading />;

    const { classes = [], quizzes = [] } = data ?? {};

    // Архивираните се показват отделно — иначе списъкът расте с всеки час.
    const current = quizzes.filter((q) => !q.archived_at);
    const archived = quizzes.filter((q) => q.archived_at);

    async function createClass(e) {
        e.preventDefault();
        const { ok } = await feedback.act(
            () => api.classes.create({ teacherId: teacher.id, ...classDraft }),
            'Класът е създаден.'
        );
        if (ok) {
            setClassDraft({ name: '', grade: 1 });
            reload();
        }
    }

    async function createQuiz(e) {
        e.preventDefault();
        const { ok, result } = await feedback.act(() =>
            api.quizzes.create({ teacherId: teacher.id, ...quizDraft })
        );
        if (ok) navigate(`/teacher/quiz/${result.id}`);
    }

    return (
        <div className="page stack">
            <h1>Здравей, {teacher.full_name}!</h1>

            <Feedback error={error || feedback.error} notice={feedback.notice} />

            <section className="stack">
                <h2>Моите класове</h2>
                {classes.length === 0 && <p className="muted">Още нямаш класове. Създай първия отдолу.</p>}

                <ul className="tiles">
                    {classes.map((c) => (
                        <li key={c.id}>
                            <Link to={`/teacher/class/${c.id}`} className="tile">
                                <span className="tile__title">
                                    {c.grade}. клас · {c.name}
                                </span>
                                <span className="small muted">Код за влизане: {c.join_code}</span>
                            </Link>
                        </li>
                    ))}
                </ul>

                <form className="card stack" onSubmit={createClass}>
                    <h3>Нов клас</h3>
                    <div className="row">
                        <TextField
                            label="Име на класа"
                            style={{ flex: '2 1 200px' }}
                            value={classDraft.name}
                            onChange={(e) => setClassDraft((s) => ({ ...s, name: e.target.value }))}
                            placeholder="напр. 2А"
                            required
                            maxLength={40}
                        />
                        <SelectField
                            label="Клас"
                            style={{ flex: '1 1 120px' }}
                            options={gradeOptions()}
                            value={classDraft.grade}
                            onChange={(e) => setClassDraft((s) => ({ ...s, grade: e.target.value }))}
                        />
                    </div>
                    <button type="submit" className="btn" disabled={feedback.busy}>
                        Създай клас
                    </button>
                </form>
            </section>

            <section className="stack">
                <h2>Моите тестове</h2>
                {quizzes.length === 0 && <p className="muted">Още нямаш тестове.</p>}

                <ul className="tiles">
                    {current.map((q) => (
                        <li key={q.id}>
                            <Link to={`/teacher/quiz/${q.id}`} className="tile">
                                <span className="tile__title">{q.title}</span>
                                <span className="small muted">
                                    {q.subject} · {q.grade}. клас
                                </span>
                                <span>
                                    <QuizBadge quiz={q} />
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>

                {archived.length > 0 && (
                    <>
                        <h3>Изминали</h3>
                        <p className="muted small">
                            Тези тестове се прибраха в архива при отваряне на нов час. Децата вече не ги
                            виждат, но резултатите остават.
                        </p>
                        <ul className="tiles">
                            {archived.map((q) => (
                                <li key={q.id}>
                                    <Link
                                        to={`/teacher/quiz/${q.id}`}
                                        className="tile"
                                        style={{ opacity: 0.7 }}
                                    >
                                        <span className="tile__title">{q.title}</span>
                                        <span className="small muted">
                                            {q.subject} ·{' '}
                                            {new Date(q.archived_at).toLocaleDateString('bg-BG')}
                                        </span>
                                        <span>
                                            <QuizBadge quiz={q} />
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                <form className="card stack" onSubmit={createQuiz}>
                    <h3>Нов тест</h3>
                    <TextField
                        label="Заглавие"
                        value={quizDraft.title}
                        onChange={(e) => setQuizDraft((s) => ({ ...s, title: e.target.value }))}
                        placeholder="напр. Събиране до 20"
                        required
                        minLength={2}
                        maxLength={120}
                    />
                    <div className="row">
                        <SelectField
                            label="Предмет"
                            style={{ flex: '2 1 220px' }}
                            options={SUBJECTS}
                            value={quizDraft.subject}
                            onChange={(e) => setQuizDraft((s) => ({ ...s, subject: e.target.value }))}
                        />
                        <SelectField
                            label="Клас"
                            style={{ flex: '1 1 110px' }}
                            options={gradeOptions()}
                            value={quizDraft.grade}
                            onChange={(e) => setQuizDraft((s) => ({ ...s, grade: e.target.value }))}
                        />
                        <SelectField
                            label="За кой клас"
                            hint="може и по-късно"
                            style={{ flex: '2 1 200px' }}
                            options={classOptions(classes)}
                            value={quizDraft.classId}
                            onChange={(e) => setQuizDraft((s) => ({ ...s, classId: e.target.value }))}
                        />
                    </div>
                    <button type="submit" className="btn" disabled={feedback.busy || GRADES.length === 0}>
                        Създай и добави въпроси
                    </button>
                </form>
            </section>
        </div>
    );
}
