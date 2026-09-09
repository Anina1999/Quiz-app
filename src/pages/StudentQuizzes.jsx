import { Link } from 'react-router-dom';
import * as api from '../api/index.js';
import { useStudent } from '../lib/student.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Badge, Feedback, Loading, ProgressBar } from '../components/ui.jsx';

/**
 * Редът над списъка: защо тестовете са заключени в момента.
 *
 * Обещанието „тестът те чака“ се дава само когато наистина има какво да се
 * решава. Дете, което вече е решило всичко, го четеше и се питаше кой тест го
 * чака — съобщението му обещаваше нещо, което го няма. Затова текстът зависи и
 * от `pending`.
 *
 * Упражнението се брои за чакащо: то се решава колкото пъти детето поиска.
 */
function lessonNotice({ absent, absentKind, lessonOpen, pending }) {
    if (absent) {
        const lesson = absentKind === 'lesson';
        return {
            emoji: lesson ? '⏸' : '🏠',
            headline: lesson ? 'Този час не си в клас.' : 'Не си в клас.',
            body: !pending
                ? 'Решил си всичко засега.'
                : lesson
                  ? 'Тестът те чака за следващия час.'
                  : 'Тестът те чака — ще го решиш, когато се върнеш в клас.',
        };
    }

    if (!lessonOpen) {
        return {
            emoji: '⏸',
            headline: 'Часът не е започнал.',
            body: pending
                ? 'Тестовете се решават в клас — учителят ще отвори часа.'
                : 'Решил си всичко засега.',
        };
    }

    return null;
}

export default function StudentQuizzes() {
    const { student } = useStudent();

    const { data, loading, error } = useAsync(
        async () => ({
            quizzes: await api.play.myQuizzes(student.id),
            progress: await api.play.myProgress(student.id),
            lesson: await api.play.lessonState(student.id),
        }),
        [student.id]
    );

    if (loading) return <Loading />;

    const { quizzes = [], progress = [], lesson } = data ?? {};

    // Сесията на детето живее часове, а записът на устройството — още повече.
    // Затова списъкът може да се отвори и вечерта вкъщи. Тестовете се решават
    // в час; тук го казваме направо, вместо да оставим детето да натисне и да
    // получи грешка от базата.
    const lessonOpen = Boolean(lesson?.open);

    // Учителят е отбелязал детето като отсъстващо. То може да влезе, но тестът
    // е заключен — иначе би го решило от вкъщи заедно с класа.
    //
    // Двата случая искат различен текст: „когато се върнеш“ при отсъствие от
    // училище, „следващия път“ при пропуснат един час. Тонът е важен и в двата:
    // детето не е наказано, тестът просто го чака.
    const absent = Boolean(lesson?.absent);
    const absentKind = lesson?.absent_kind;

    const pending = quizzes.some((q) => q.is_practice || q.attempts_count === 0);
    const notice = lessonNotice({ absent, absentKind, lessonOpen, pending });

    return (
        <div className="page stack">
            <h1>Здравей, {student.display_name}! 👋</h1>

            <Feedback error={error} />

            {notice && (
                <p className="alert alert--info" role="status">
                    {notice.emoji} <strong>{notice.headline}</strong> {notice.body}
                    {/* Поканата се дава само ако има към какво да прати детето —
                        иначе сочи към секция, която изобщо не се показва. */}
                    {progress.length > 0 && ' Можеш да разгледаш как се справяш.'}
                </p>
            )}

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
                            {/* Причината плочката да не се натиска е важна:
                                „предаден“ и „часът не е започнал“ са различни
                                неща за детето. Извън час обяснението е горе,
                                едно за целия списък, за да не се повтаря на
                                всяка плочка. */}
                            {absent && !done && (
                                <span className="small muted">
                                    {absentKind === 'lesson'
                                        ? 'Предстои да го решиш следващия час.'
                                        : 'Предстои да го решиш, когато се върнеш в клас.'}
                                </span>
                            )}
                            {!q.can_start && !absent && lessonOpen && !q.is_practice && (
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
