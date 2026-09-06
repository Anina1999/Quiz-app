import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/index.js';
import { Badge, SelectField } from './ui.jsx';

/** Продължителности, които имат смисъл в училищен график. */
const DURATIONS = [15, 30, 45, 60].map((m) => ({ value: m, label: `${m} минути` }));

const DEFAULT_MINUTES = 45;

/** Колко често питаме базата в какво състояние е часът. */
const POLL_MS = 15000;

function formatLeft(seconds) {
    if (seconds == null) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m} мин. ${String(s).padStart(2, '0')} сек.` : `${s} сек.`;
}

/**
 * Съгласуване по число. „1 ученик решава“ / „3 ученици решават“, и съответно
 * „да МУ дам ли“ / „да ИМ дам ли“ — иначе изречението звучи счупено точно в
 * най-честия случай, когато е останало едно дете.
 */
function pupils(n) {
    return n === 1
        ? { noun: 'ученик', verb: 'решава', finishing: 'довършва', finish: 'довърши', pronoun: 'му' }
        : { noun: 'ученици', verb: 'решават', finishing: 'довършват', finish: 'довършат', pronoun: 'им' };
}

/**
 * Часът: отваряне на класа и броячът към края му.
 *
 * Три правила, които идват от начина, по който върви един учебен час:
 *   * времето се избира веднъж и не се променя — децата трябва да знаят
 *     докога решават;
 *   * класът не се затваря по-рано по същата причина;
 *   * когато времето изтече и още има деца върху теста, учителят решава дали
 *     да им даде 5 минути да довършат. Веднъж на час.
 *
 * Състоянието идва от базата (class_lesson_state), а не се смята тук —
 * само тя знае колко деца всъщност още решават.
 */
export function JoiningWindow({ classId, joinCode, onChanged }) {
    const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            setState(await api.classes.lessonState(classId));
        } catch (err) {
            setError(err.message ?? String(err));
        }
    }, [classId]);

    // Броячът тиктака локално, а на всеки POLL_MS се сверява с базата.
    useEffect(() => {
        refresh();
        const poll = setInterval(refresh, POLL_MS);
        const tick = setInterval(() => {
            setState((s) =>
                s && s.seconds_left > 0 ? { ...s, seconds_left: s.seconds_left - 1 } : s
            );
        }, 1000);
        return () => {
            clearInterval(poll);
            clearInterval(tick);
        };
    }, [refresh]);

    async function act(fn) {
        setError('');
        setBusy(true);
        try {
            await fn();
            await refresh();
            onChanged?.();
        } catch (err) {
            setError(err.message ?? String(err));
        } finally {
            setBusy(false);
        }
    }

    if (!state) return null;

    const { phase, seconds_left: left, still_playing: playing, can_grant_grace, grace_used } = state;
    const p = pupils(playing);

    return (
        <section className="card stack">
            <div className="row row--between">
                <h2 style={{ margin: 0 }}>Часът</h2>
                <Badge kind={phase === 'open' ? 'ok' : phase === 'grace' ? undefined : 'muted'}>
                    {(phase === 'open' || phase === 'grace') && `Оставащи: ${formatLeft(left)}`}
                    {phase === 'expired' && 'Приключи'}
                    {phase === 'closed' && 'Не е започнал'}
                </Badge>
            </div>

            {error && (
                <p className="alert alert--error" role="alert">
                    {error}
                </p>
            )}

            {/* --- Часът не е започнал -------------------------------------- */}
            {(phase === 'closed' || phase === 'expired') && !can_grant_grace && (
                <>
                    <p className="muted">
                        Само кодът <strong>{joinCode}</strong> не стига — класът трябва да е отворен.
                        Времето се избира веднъж и не може да се променя, докато часът тече.
                    </p>
                    <div className="row">
                        <SelectField
                            label="Отвори за"
                            style={{ flex: '1 1 180px', maxWidth: 240 }}
                            options={DURATIONS}
                            value={minutes}
                            onChange={(e) => setMinutes(Number(e.target.value))}
                        />
                        <button
                            type="button"
                            className="btn"
                            style={{ alignSelf: 'flex-end' }}
                            disabled={busy}
                            onClick={() => act(() => api.classes.open(classId, minutes))}
                        >
                            Отвори
                        </button>
                    </div>
                </>
            )}

            {/* --- Часът тече ----------------------------------------------- */}
            {phase === 'open' && (
                <>
                    <p className="muted">
                        Децата влизат с код <strong>{joinCode}</strong>. Времето не може да се удължава,
                        нито часът да се затваря по-рано.
                    </p>
                    <p>
                        {playing > 0
                            ? `Върху теста в момента: ${playing} ${p.noun}.`
                            : 'Още никой не е започнал тест.'}
                    </p>
                </>
            )}

            {/* --- Времето изтече, но има деца върху теста ------------------- */}
            {can_grant_grace && (
                <div className="alert alert--info stack">
                    <p style={{ margin: 0 }}>
                        <strong>Времето изтече.</strong> Още {playing} {p.noun} {p.verb} теста. Да{' '}
                        {p.pronoun} дам ли още 5 минути да {p.finish}?
                    </p>
                    <p className="small" style={{ margin: 0 }}>
                        Ако откажеш, резултатите им се запазват такива, каквито са в момента. Гратис се
                        дава само веднъж на час.
                    </p>
                    <div className="row">
                        <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => act(() => api.classes.grantGrace(classId))}
                        >
                            Да, още 5 минути
                        </button>
                        <button type="button" className="btn btn--quiet" disabled={busy} onClick={refresh}>
                            Не, приключи сега
                        </button>
                    </div>
                </div>
            )}

            {/* --- Тече гратисът -------------------------------------------- */}
            {phase === 'grace' && (
                <p className="alert alert--info" role="status">
                    ⏳ Оставащи: <strong>{formatLeft(left)}</strong>.{' '}
                    {playing > 0 ? `${playing} ${p.noun} ${p.finishing}.` : 'Всички са готови.'} Нови
                    влизания вече не се приемат.
                </p>
            )}

            {phase === 'expired' && grace_used && (
                <p className="muted small">Гратисът за този час е използван.</p>
            )}
        </section>
    );
}
