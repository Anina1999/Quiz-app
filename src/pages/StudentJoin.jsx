import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import * as api from '../api/index.js';
import { useStudent } from '../lib/student.jsx';
import { errorText } from '../lib/supabase.js';
import { classLabel } from '../lib/constants.js';
import { useFeedback } from '../hooks/useFeedback.js';
import { Feedback, Field, Loading } from '../components/ui.jsx';

export default function StudentJoin() {
    const { student, ready, ensureSession, join } = useStudent();
    const navigate = useNavigate();
    const feedback = useFeedback();

    const [code, setCode] = useState('');
    const [preview, setPreview] = useState(null);

    const [sessionError, setSessionError] = useState('');
    const preparing = useRef(false);

    // Анонимната сесия се подготвя чак тук — при отваряне на ученическия екран.
    // Ако на устройството има учителска сесия, тя се прекратява първо, за да не
    // работи детето с чужди права.
    const prepare = useCallback(async () => {
        // React StrictMode пуска ефекта два пъти; без този предпазител двете
        // извиквания се преплитат във влизането.
        if (preparing.current) return;
        preparing.current = true;
        setSessionError('');
        try {
            await ensureSession();
        } catch (err) {
            setSessionError(errorText(err));
        } finally {
            preparing.current = false;
        }
    }, [ensureSession]);

    useEffect(() => {
        if (!student) prepare();
    }, [student, prepare]);

    if (student) return <Navigate to="/student/quizzes" replace />;

    // ВАЖНО: грешката се показва ПРЕДИ индикатора за зареждане. Иначе провал
    // при подготовката на сесията изглежда като безкрайно „Момент…“.
    if (sessionError) {
        return (
            <div className="page page--narrow stack">
                <h1>Влизане в класа</h1>
                <Feedback error={sessionError} />
                <button type="button" className="btn" onClick={prepare}>
                    Опитай пак
                </button>
            </div>
        );
    }

    if (!ready) return <Loading>Момент…</Loading>;

    async function findClass(e) {
        e.preventDefault();
        const { ok, result } = await feedback.act(() => api.play.classPreview(code));
        if (ok) setPreview(result);
    }

    async function pick(studentId) {
        const { ok } = await feedback.act(() => join(code, studentId));
        if (ok) {
            navigate('/student/quizzes', { replace: true });
            return;
        }
        // Друго дете може да е заело псевдонима междувременно — опресняваме списъка,
        // за да не остане бутонът примамливо активен.
        try {
            setPreview(await api.play.classPreview(code));
        } catch {
            /* показаната грешка е достатъчна */
        }
    }

    return (
        <div className="page page--narrow stack">
            <h1>Влизане в класа</h1>

            <Feedback error={feedback.error} />

            {!preview ? (
                <form className="card stack" onSubmit={findClass}>
                    <Field label="Кодът от дъската" hint="6 букви и цифри">
                        <input
                            className="code-input"
                            value={code}
                            onChange={(e) => setCode(e.target.value.toUpperCase())}
                            maxLength={6}
                            minLength={6}
                            required
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                        />
                    </Field>
                    <button type="submit" className="btn btn--big btn--block" disabled={feedback.busy}>
                        {feedback.busy ? 'Търся…' : 'Напред'}
                    </button>
                </form>
            ) : (
                <div className="card stack">
                    <h2>{classLabel(preview.class)}</h2>
                    <p className="muted">Намери своето име и го натисни.</p>

                    <ul className="tiles">
                        {preview.students.map((s) => (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    className="tile"
                                    onClick={() => pick(s.id)}
                                    disabled={s.is_taken || feedback.busy}
                                    style={s.is_taken ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                                >
                                    <span className="tile__title">
                                        {s.roll_number ? `${s.roll_number}. ` : ''}
                                        {s.display_name}
                                    </span>
                                    {s.is_taken && <span className="small muted">вече е зает</span>}
                                </button>
                            </li>
                        ))}
                    </ul>

                    {preview.students.length === 0 && (
                        <p className="alert alert--info">
                            В този клас още няма добавени ученици. Кажи на учителя.
                        </p>
                    )}

                    <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={() => {
                            setPreview(null);
                            feedback.clear();
                        }}
                    >
                        ← Друг код
                    </button>
                </div>
            )}
        </div>
    );
}
