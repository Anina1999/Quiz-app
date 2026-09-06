import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useFeedback } from '../hooks/useFeedback.js';
import { Feedback, TextField } from '../components/ui.jsx';

export default function TeacherLogin() {
    const { session, teacher, signIn, signUp } = useAuth();
    const navigate = useNavigate();
    const feedback = useFeedback();

    const [mode, setMode] = useState('signin');
    const [form, setForm] = useState({ email: '', password: '', fullName: '', school: '' });

    if (session?.user?.email && teacher) return <Navigate to="/teacher" replace />;

    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    async function handleSubmit(e) {
        e.preventDefault();

        const { ok, result } = await feedback.act(async () => {
            const fn = mode === 'signin' ? signIn : signUp;
            const { data, error } = await fn({
                email: form.email.trim(),
                password: form.password,
                fullName: form.fullName.trim(),
                school: form.school.trim(),
            });
            if (error) throw error;
            return data;
        });

        if (!ok) return;

        // При включено потвърждение по email signUp не връща сесия веднага.
        if (result.session) navigate('/teacher', { replace: true });
        else feedback.setNotice('Изпратихме ти писмо. Потвърди го и се върни тук, за да влезеш.');
    }

    const isSignUp = mode === 'signup';

    return (
        <div className="page page--narrow">
            <div className="card stack">
                <h1>{isSignUp ? 'Регистрация на учител' : 'Вход за учители'}</h1>

                <Feedback error={feedback.error} notice={feedback.notice} />

                <form onSubmit={handleSubmit} className="stack">
                    {isSignUp && (
                        <>
                            <TextField
                                label="Име и фамилия"
                                value={form.fullName}
                                onChange={set('fullName')}
                                required
                                minLength={2}
                                maxLength={120}
                                autoComplete="name"
                            />
                            <TextField
                                label="Училище"
                                hint="по избор"
                                value={form.school}
                                onChange={set('school')}
                                maxLength={200}
                            />
                        </>
                    )}

                    <TextField
                        label="Email"
                        type="email"
                        value={form.email}
                        onChange={set('email')}
                        required
                        autoComplete="email"
                    />

                    <TextField
                        label="Парола"
                        hint={isSignUp ? 'поне 8 знака' : undefined}
                        type="password"
                        value={form.password}
                        onChange={set('password')}
                        required
                        minLength={8}
                        autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    />

                    <button type="submit" className="btn btn--block" disabled={feedback.busy}>
                        {feedback.busy ? 'Момент…' : isSignUp ? 'Създай профил' : 'Вход'}
                    </button>
                </form>

                <button
                    type="button"
                    className="btn btn--quiet btn--block"
                    onClick={() => {
                        setMode(isSignUp ? 'signin' : 'signup');
                        feedback.clear();
                    }}
                >
                    {isSignUp ? 'Вече имам профил — вход' : 'Нямам профил — регистрация'}
                </button>

                {/* Само при регистрация: там учителят си гради представата как
                    работи приложението и може да тръгне да прави акаунти на
                    децата. На екрана за вход редът е излишен — човекът вече знае. */}
                {isSignUp && (
                    <p className="small muted">
                        Учениците не се регистрират и нямат профили. Те влизат с кода на класа.
                    </p>
                )}
            </div>
        </div>
    );
}
