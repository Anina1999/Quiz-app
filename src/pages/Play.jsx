import { useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStudent } from '../lib/student.jsx';
import { useSound } from '../lib/useSound.js';
import { useQuizGame } from '../game/useQuizGame.js';
import { AnswerButton, Verdict } from '../game/AnswerButton.jsx';
import { Feedback, Loading, ProgressBar } from '../components/ui.jsx';

/** Насърчението накрая — по-мек текст при слаб резултат. */
function encouragement(percent) {
    if (percent >= 80) return 'Отлично се справи!';
    if (percent >= 50) return 'Добре! Опитай пак, за да станеш още по-добър.';
    return 'Няма страшно — упражнявай се и ще стане.';
}

export default function Play() {
    const { quizId } = useParams();
    const { student } = useStudent();
    const navigate = useNavigate();
    const { play, muted, toggleMuted } = useSound();
    const questionRef = useRef(null);

    const onFeedback = useCallback((isCorrect) => play(isCorrect ? 'correct' : 'wrong'), [play]);

    const game = useQuizGame({ studentId: student.id, quizId, onFeedback });

    // Фокусът отива на новия въпрос, за да го прочете екранният четец.
    useEffect(() => {
        if (game.status === 'answering') questionRef.current?.focus();
    }, [game.status, game.index]);

    if (game.status === 'loading') return <Loading>Подготвям теста…</Loading>;

    if (game.status === 'error') {
        return (
            <div className="page page--narrow stack">
                <Feedback error={game.error} />
                <Link to="/student/quizzes" className="btn">
                    Обратно към тестовете
                </Link>
            </div>
        );
    }

    if (game.status === 'done') {
        const { score, max_score: max } = game.result;
        const percent = max ? Math.round((score / max) * 100) : 0;

        return (
            <div className="page page--narrow">
                <div className="card stack result">
                    <h1>Готово! 🎉</h1>
                    <p className="result__score">
                        {score} / {max}
                    </p>
                    <p className="muted">{encouragement(percent)}</p>
                    <button
                        type="button"
                        className="btn btn--block"
                        onClick={() => navigate('/student/quizzes')}
                    >
                        Обратно към тестовете
                    </button>
                </div>
            </div>
        );
    }

    const revealed = game.status === 'revealed';

    return (
        <div className="page">
            <div className="card stack">
                <div className="quiz-head">
                    <span>
                        Въпрос <strong>{game.index + 1}</strong> от <strong>{game.total}</strong>
                    </span>
                    {/* Тест без таймер изобщо не показва часовник — иначе
                        празното поле само по себе си притеснява децата. */}
                    {game.hasTimer && (
                        <span className={game.timeLeft <= 5 ? 'timer timer--low' : 'timer'}>
                            ⏱ {revealed ? '—' : `${game.timeLeft} сек.`}
                        </span>
                    )}
                    {/* Заглушаването е нужно в класна стая с 25 деца. */}
                    <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={toggleMuted}
                        aria-pressed={muted}
                    >
                        {muted ? '🔇 Звукът е изключен' : '🔊 Звукът е включен'}
                    </button>
                </div>

                <ProgressBar
                    percent={((game.index + 1) / game.total) * 100}
                    label={`Въпрос ${game.index + 1} от ${game.total}`}
                />

                {/* Часът е свършил, но детето довършва. Показва се само в гратиса. */}
                {game.graceSeconds !== null && game.graceSeconds > 0 && (
                    <p className="alert alert--info" role="status">
                        ⏳ Часът свърши. Имаш още{' '}
                        <strong>{Math.ceil(game.graceSeconds / 60)} мин.</strong>, за да довършиш.
                        Резултатът ти се запазва.
                    </p>
                )}

                <h1 className="question" tabIndex={-1} ref={questionRef}>
                    {game.question.prompt}
                </h1>

                {/* Подсказката на учителя — вижда се ПРЕДИ отговора. */}
                {game.question.hint && <p className="hint">💬 {game.question.hint}</p>}

                {game.question.image_url && (
                    <img
                        src={game.question.image_url}
                        alt=""
                        style={{ maxWidth: '100%', borderRadius: 12 }}
                    />
                )}

                <ul className="answers">
                    {game.question.answers.map((a) => (
                        <li key={a.id}>
                            <AnswerButton
                                answer={a}
                                verdict={game.verdict}
                                revealed={revealed}
                                onPick={game.answer}
                            />
                        </li>
                    ))}
                </ul>

                {/* Резултатът от отговора се съобщава и на екранния четец. */}
                <div aria-live="polite" role="status">
                    {revealed && <Verdict verdict={game.verdict} />}
                </div>

                <Feedback error={game.error} />

                {revealed && (
                    <button type="button" className="btn btn--big btn--block" onClick={game.next} autoFocus>
                        {game.isLast ? 'Виж резултата' : 'Следващ въпрос'}
                    </button>
                )}

                <p className="small muted">
                    Точки досега: {game.score} от {game.maxScore}
                </p>
            </div>
        </div>
    );
}
