import { Link } from 'react-router-dom';
import * as api from '../api/index.js';
import { useStudent } from '../lib/student.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Badge, Feedback, Loading, ProgressBar } from '../components/ui.jsx';

export default function StudentQuizzes() {
    const { student } = useStudent();

    const { data, loading, error } = useAsync(
        async () => ({
            quizzes: await api.play.myQuizzes(student.id),
            progress: await api.play.myProgress(student.id),
        }),
        [student.id]
    );

    if (loading) return <Loading />;

    const { quizzes = [], progress = [] } = data ?? {};

    return (
        <div className="page stack">
            <h1>Здравей, {student.display_name}! 👋</h1>

            <Feedback error={error} />

            <h2>Тестове за теб</h2>
            {quizzes.length === 0 && <p className="alert alert--info">Няма нови тестове. Попитай учителя.</p>}

            <ul className="tiles">
                {quizzes.map((q) => {
                    const done = q.attempts_count > 0;
                    // Обикновен тест се решава веднъж — плочката става само за
                    // гледане. Упражнението остава натискаемо винаги.
                    const inner = (
                        <>
                            <span className="tile__title">{q.title}</span>
                            <span className="small muted">
                                {q.subject} · {q.question_count} въпроса
                                {q.is_practice && ' · упражнение'}
                            </span>
                            <span>
                                {done ? (
                                    <Badge kind="ok">
                                        {q.is_practice ? 'Най-добър резултат' : 'Решен'}: {q.best_score}{' '}
                                        / {q.max_score}
                                    </Badge>
                                ) : (
                                    <Badge>Още не си го решавал</Badge>
                                )}
                            </span>
                            {!q.can_start && (
                                <span className="small muted">Този тест вече е предаден.</span>
                            )}
                        </>
                    );

                    return (
                        <li key={q.id}>
                            {q.can_start ? (
                                <Link to={`/student/play/${q.id}`} className="tile">
                                    {inner}
                                </Link>
                            ) : (
                                <div className="tile" style={{ opacity: 0.6, cursor: 'default' }}>
                                    {inner}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            {progress.length > 0 && (
                <section className="card stack">
                    <h2>Как се справяш</h2>
                    <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {progress.map((p) => (
                            <li key={p.subject}>
                                <div className="row row--between">
                                    <span>{p.subject}</span>
                                    <strong>{p.percent ?? 0}%</strong>
                                </div>
                                <ProgressBar
                                    percent={p.percent}
                                    label={`${p.subject}: ${p.percent ?? 0} процента от ${p.attempts} теста`}
                                />
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
