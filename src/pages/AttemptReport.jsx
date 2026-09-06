import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import * as api from '../api/index.js';
import { useAsync } from '../hooks/useAsync.js';
import { BackLink, Feedback, Loading } from '../components/ui.jsx';

const APP_TITLE = 'Тестове за 1.–4. клас';

const date = (value) =>
    value ? new Date(value).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const time = (value) =>
    value ? new Date(value).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' }) : '';

const seconds = (ms) => (ms == null ? '—' : `${Math.round(ms / 1000)} сек.`);

/** Ред от заглавната част: етикет и стойност. */
function Meta({ label, children, wide }) {
    return (
        <div className={wide ? 'report__meta-row report__meta-row--wide' : 'report__meta-row'}>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

/**
 * Протокол на решен тест — за разпечатване или запазване като PDF.
 *
 * Нарочно НЕ се ползва PDF библиотека. jsPDF и подобните вграждат латински
 * шрифтове по подразбиране и кирилицата излиза като квадратчета; правилният
 * шрифт тежи стотици килобайта. Печатът на браузъра дава верни букви, търсим
 * текст и нулев размер на приложението.
 */
export default function AttemptReport() {
    const { attemptId } = useParams();

    const { data, loading, error } = useAsync(
        () => api.quizzes.attemptReport(attemptId),
        [attemptId]
    );

    /*
     * Браузърът кръщава PDF файла по заглавието на страницата и го изписва в
     * горния колонтитул. Затова за времето на престоя тук заглавието става
     * името на теста и псевдонима — така файловете се различават един от друг
     * в папката на учителя.
     */
    useEffect(() => {
        if (!data) return;
        document.title = `${data.quiz.title} — ${data.student.display_name}`;
        return () => {
            document.title = APP_TITLE;
        };
    }, [data]);

    if (loading) return <Loading />;
    if (!data) return <Feedback error={error || 'Резултатът не е намерен.'} />;

    const { attempt, student, class: klass, quiz, questions } = data;
    const percent = attempt.max_score ? Math.round((attempt.score / attempt.max_score) * 100) : 0;

    return (
        <div className="page report">
            <div className="no-print stack">
                <BackLink />
                <button type="button" className="btn" onClick={() => window.print()}>
                    🖨 Запази като PDF или разпечатай
                </button>
                <p className="small muted">
                    В прозореца за печат избери <strong>„Запази като PDF“</strong>. Ако не искаш адреса и
                    датата най-горе и най-долу, махни отметката{' '}
                    <strong>„Колонтитули“ / „Headers and footers“</strong> в настройките на печата.
                </p>
            </div>

            <header className="report__head">
                <h1>Протокол от тест</h1>
                <p className="report__subject">{quiz.title}</p>

                <dl className="report__meta">
                    <Meta label="Предмет">{quiz.subject}</Meta>
                    <Meta label="Клас">{klass.name}</Meta>
                    <Meta label="Ученик">
                        {student.roll_number ? `№ ${student.roll_number} · ` : ''}
                        {student.display_name}
                    </Meta>
                    <Meta label="Дата">
                        {date(attempt.finished_at)}
                        {time(attempt.finished_at) && `, ${time(attempt.finished_at)} ч.`}
                    </Meta>
                    <Meta label="Резултат" wide>
                        <strong>
                            {attempt.score} от {attempt.max_score}
                        </strong>{' '}
                        точки · {percent}%{quiz.is_practice && ' · упражнение'}
                    </Meta>
                </dl>
            </header>

            <ol className="report__questions">
                {questions.map((q, i) => (
                    <li key={i} className={q.is_correct ? 'report__q report__q--ok' : 'report__q'}>
                        <p className="report__prompt">
                            <strong>{q.prompt}</strong>
                            <span className="report__mark">
                                {q.is_correct ? '✓ вярно' : q.answered ? '✗ грешно' : '⏰ без отговор'}
                            </span>
                        </p>
                        <p className="report__answer">
                            Отговор: <strong>{q.given_answer ?? '— не е отговорено —'}</strong>
                            {!q.is_correct && (
                                <>
                                    {' · '}верен: <strong>{q.correct_answer}</strong>
                                </>
                            )}
                            <span className="report__time"> ({seconds(q.time_taken_ms)})</span>
                        </p>
                    </li>
                ))}
            </ol>

            <footer className="report__foot">
                <p className="small muted">
                    Документът съдържа само псевдонима на ученика. Съответствието с конкретно дете се
                    пази извън приложението.
                </p>

                {/*
                 * Адресът се печата ТУК, вътре в документа, а не се разчита на
                 * колонтитула на браузъра. Той го съкращава до „…“ и не може да
                 * бъде преоформен от страницата. Нашият ред се пренася на нов
                 * ред и се вижда докрай.
                 */}
                <p className="report__link">
                    Протокол № {attempt.id}
                    <br />
                    {window.location.href}
                </p>

                <div className="report__sign">
                    <span>Учител: ...................................</span>
                    <span>Дата: ..................</span>
                </div>
            </footer>
        </div>
    );
}
