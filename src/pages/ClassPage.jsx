import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as api from '../api/index.js';
import { classLabel } from '../lib/constants.js';
import { useAsync } from '../hooks/useAsync.js';
import { useFeedback } from '../hooks/useFeedback.js';
import { Badge, BackLink, Feedback, Loading, TextField } from '../components/ui.jsx';
import { JoiningWindow } from '../components/JoiningWindow.jsx';

/** Групира редовете от class_progress по учебен предмет. */
function groupBySubject(rows) {
    const map = new Map();
    for (const row of rows) {
        if (!map.has(row.subject)) map.set(row.subject, []);
        map.get(row.subject).push(row);
    }
    return [...map.entries()];
}

export default function ClassPage() {
    const { classId } = useParams();
    const feedback = useFeedback();
    const [draft, setDraft] = useState({ displayName: '', rollNumber: '' });

    const { data, loading, error, reload, setData } = useAsync(
        async () => ({
            klass: await api.classes.get(classId),
            students: await api.students.listByClass(classId),
            progress: await api.classes.progress(classId),
            attempts: await api.quizzes.attemptsByClass(classId),
        }),
        [classId]
    );

    if (loading) return <Loading />;
    if (!data) return <Feedback error={error || 'Класът не е намерен.'} />;

    const { klass, students, progress, attempts } = data;

    // Отметката „няма го този час“ се закача за конкретния час, затова има
    // смисъл само докато той тече.
    const lessonOpen = api.classes.isJoiningOpen(klass);

    async function addStudent(e) {
        e.preventDefault();
        const { ok } = await feedback.act(() => api.students.create({ classId, ...draft }));
        if (ok) {
            setDraft({ displayName: '', rollNumber: '' });
            reload();
        }
    }

    async function releaseStudent(id, name) {
        const { ok } = await feedback.act(
            () => api.students.releaseSession(id),
            `„${name}“ вече може да влезе от друго устройство.`
        );
        if (ok) reload();
    }

    /*
     * Отсъстващото дете може да влезе в класа, но не може да започне тест —
     * иначе решава от вкъщи заедно с класа.
     *
     * Двата случая са различни нарочно: „отсъства от училище“ важи до
     * връщането (иначе на другия ден болното дете пак може да мами), а „няма
     * го този час“ пада от само себе си при следващия час.
     */
    async function toggleAbsent(s) {
        const absent = !api.students.isAbsent(s);
        const { ok } = await feedback.act(
            () => api.students.setAbsent(s.id, absent),
            absent
                ? `„${s.display_name}“ отсъства. Тестовете му остават заключени, докато не го върнеш.`
                : `„${s.display_name}“ се върна и отново може да решава.`
        );
        if (ok) reload();
    }

    async function toggleAbsentThisLesson(s) {
        const absent = !api.students.isAbsentThisLesson(s, klass);
        const { ok } = await feedback.act(
            () => api.students.setAbsentThisLesson(s.id, absent),
            absent
                ? `„${s.display_name}“ е извън този час. Следващият час пак ще може.`
                : `„${s.display_name}“ отново решава в този час.`
        );
        if (ok) reload();
    }

    async function removeStudent(id, name) {
        if (!window.confirm(`Да изтрия ли „${name}“? Резултатите му също се изтриват.`)) return;
        const { ok } = await feedback.act(() => api.students.remove(id));
        if (ok) reload();
    }

    async function newCode() {
        const { ok, result } = await feedback.act(
            () => api.classes.newJoinCode(classId),
            'Готово — новият код е на екрана. Старият вече не важи.'
        );
        if (ok) setData({ ...data, klass: { ...klass, join_code: result } });
    }

    async function resetSessions() {
        const { ok, result } = await feedback.act(() => api.classes.resetSessions(classId));
        if (ok) {
            feedback.setNotice(`Освободени псевдоними: ${result}. Децата могат да влязат отново.`);
            reload();
        }
    }

    return (
        <div className="page stack">
            <BackLink />
            <h1>{classLabel(klass)}</h1>

            <Feedback error={error || feedback.error} notice={feedback.notice} />

            <JoiningWindow classId={classId} joinCode={klass.join_code} onChanged={reload} />

            <section className="card stack">
                <h2>Код за влизане</h2>
                <p className="muted">
                    Напиши го на дъската. Децата го въвеждат и избират името си от списък. Кодът може да
                    стои постоянно — сам по себе си не отваря класа.
                </p>
                <p>
                    <span className="join-code">{klass.join_code}</span>
                </p>
                <div className="row">
                    <button type="button" className="btn btn--quiet" onClick={newCode}>
                        Нов код
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={resetSessions}>
                        Освободи всички псевдоними
                    </button>
                </div>
            </section>

            <section className="card stack">
                <h2>Ученици ({students.length})</h2>
                <p className="alert alert--info">
                    Въвеждай <strong>само псевдоним или номер</strong> — например „Ученик 7“, „Мечо“ или
                    „№ 12“. Приложението нарочно не съхранява имена на деца. Кой псевдоним на кое дете
                    отговаря, знаеш само ти — в дневника.
                </p>
                <p className="alert alert--info">
                    Отсъстващото дете може да влезе с кода, но тестът му остава заключен — така не го
                    решава от вкъщи заедно с класа. Има два случая:
                    <br />
                    <strong>🚫 Отсъства</strong> — няма го от училище. Важи до деня, в който отбележиш,
                    че се е върнало. Не пада само.
                    <br />
                    <strong>⏸ Няма го този час</strong> — на училище е, но този час е другаде. Пада от
                    само себе си при следващия час.
                </p>

                {students.length > 0 && (
                    <div className="table-wrap">
                        <table>
                            <caption className="sr-only">Списък с учениците в класа</caption>
                            <thead>
                                <tr>
                                    <th scope="col">№</th>
                                    <th scope="col">Псевдоним</th>
                                    <th scope="col">В момента</th>
                                    <th scope="col">Присъствие</th>
                                    <th scope="col">
                                        <span className="sr-only">Действия</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {students.map((s) => (
                                    <tr key={s.id}>
                                        <td>{s.roll_number ?? '—'}</td>
                                        <td>{s.display_name}</td>
                                        <td>
                                            <Badge kind={s.session_uid ? 'ok' : 'muted'}>
                                                {s.session_uid ? 'на устройство' : 'свободен'}
                                            </Badge>
                                        </td>
                                        <td>
                                            {api.students.isAbsent(s) ? (
                                                // Показваме от колко дни го няма — така не остава
                                                // заключен, защото учителят е забравил да го върне.
                                                <div
                                                    className="row"
                                                    style={{ gap: 8 }}
                                                    title={api.students.absentSinceLabel(s)}
                                                >
                                                    <Badge
                                                        kind={
                                                            api.students.isLongAbsence(s)
                                                                ? 'warn'
                                                                : 'muted'
                                                        }
                                                    >
                                                        {api.students.absentLabel(s)}
                                                    </Badge>
                                                    <button
                                                        type="button"
                                                        className="btn btn--quiet"
                                                        onClick={() => toggleAbsent(s)}
                                                    >
                                                        ↩ Върна се
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="row" style={{ gap: 8 }}>
                                                    <button
                                                        type="button"
                                                        className="btn btn--quiet"
                                                        onClick={() => toggleAbsent(s)}
                                                    >
                                                        🚫 Отсъства
                                                    </button>
                                                    {/* Само докато тече час — отметка за час, който
                                                        не е започнал, не важи за нищо. */}
                                                    {lessonOpen && (
                                                        <button
                                                            type="button"
                                                            className="btn btn--quiet"
                                                            onClick={() => toggleAbsentThisLesson(s)}
                                                            aria-pressed={api.students.isAbsentThisLesson(
                                                                s,
                                                                klass
                                                            )}
                                                        >
                                                            {api.students.isAbsentThisLesson(s, klass)
                                                                ? '↩ Върни в часа'
                                                                : '⏸ Няма го този час'}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <div className="row" style={{ gap: 8 }}>
                                                {/* Показва се само когато има какво да се освободи. */}
                                                {s.session_uid && (
                                                    <button
                                                        type="button"
                                                        className="btn btn--quiet"
                                                        onClick={() =>
                                                            releaseStudent(s.id, s.display_name)
                                                        }
                                                    >
                                                        Освободи
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className="btn btn--quiet"
                                                    onClick={() => removeStudent(s.id, s.display_name)}
                                                >
                                                    Изтрий
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <form className="row" onSubmit={addStudent}>
                    <TextField
                        label="Псевдоним"
                        style={{ flex: '2 1 200px' }}
                        value={draft.displayName}
                        onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                        placeholder="напр. Ученик 7"
                        required
                        maxLength={30}
                    />
                    <TextField
                        label="№"
                        hint="по избор"
                        style={{ flex: '1 1 110px' }}
                        type="number"
                        min="1"
                        max="40"
                        value={draft.rollNumber}
                        onChange={(e) => setDraft((d) => ({ ...d, rollNumber: e.target.value }))}
                    />
                    <button type="submit" className="btn" disabled={feedback.busy}>
                        Добави
                    </button>
                </form>
            </section>

            <section className="card stack">
                <h2>Предадени тестове</h2>
                <p className="muted small">
                    Всеки ред се отваря като протокол, който може да се разпечата или запази като PDF —
                    за документация.
                </p>

                {attempts.length === 0 && <p className="muted">Още няма предадени тестове.</p>}

                {attempts.length > 0 && (
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th scope="col">Предаден</th>
                                    <th scope="col">Ученик</th>
                                    <th scope="col">Тест</th>
                                    <th scope="col">Точки</th>
                                    <th scope="col">
                                        <span className="sr-only">Протокол</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {attempts.map((a) => (
                                    <tr key={a.id}>
                                        <td>
                                            {new Date(a.finished_at).toLocaleString('bg-BG', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </td>
                                        <td>{a.students.display_name}</td>
                                        <td>{a.quizzes?.title ?? '—'}</td>
                                        <td>
                                            {a.score} / {a.max_score}
                                        </td>
                                        <td>
                                            <Link
                                                to={`/teacher/attempt/${a.id}`}
                                                className="btn btn--quiet"
                                            >
                                                Протокол
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="card stack">
                <h2>Напредък по теми</h2>
                {progress.length === 0 && <p className="muted">Още няма решени тестове в този клас.</p>}

                {groupBySubject(progress).map(([subject, rows]) => (
                    <div key={subject} className="stack">
                        <h3>{subject}</h3>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th scope="col">Ученик</th>
                                        <th scope="col">Решени</th>
                                        <th scope="col">Точки</th>
                                        <th scope="col">Успех</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...rows]
                                        .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
                                        .map((r) => (
                                            <tr key={r.student_id}>
                                                <td>{r.display_name}</td>
                                                <td>{r.attempts}</td>
                                                <td>
                                                    {r.total_score} / {r.total_max_score}
                                                </td>
                                                <td>{r.percent ?? 0}%</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
}
