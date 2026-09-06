import { useCallback, useState } from 'react';
import { errorText } from '../lib/supabase.js';

/**
 * Съобщенията „грешка“ и „готово“, които всяка страница показва след действие.
 *
 * `act()` обгръща действие: изчиства старите съобщения, включва състояние
 * „зает“, хваща грешката и я превежда на български. Така страниците не
 * повтарят един и същ try/catch/finally около всеки бутон.
 */
export function useFeedback() {
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);

    const clear = useCallback(() => {
        setError('');
        setNotice('');
    }, []);

    const act = useCallback(
        async (fn, successMessage) => {
            clear();
            setBusy(true);
            try {
                const result = await fn();
                if (successMessage) setNotice(successMessage);
                return { ok: true, result };
            } catch (err) {
                setError(errorText(err));
                return { ok: false, error: err };
            } finally {
                setBusy(false);
            }
        },
        [clear]
    );

    return { error, notice, busy, setError, setNotice, clear, act };
}
