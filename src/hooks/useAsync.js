import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../lib/supabase.js';

/**
 * Зарежда данни и пази трите състояния, които всяка страница иначе описва сама:
 * зареждане, грешка и резултат. Връща и `reload()` за опресняване след запис.
 *
 * `deps` работи като при useEffect. Резултатът от изостанала заявка се
 * изхвърля, ако компонентът вече е размонтиран или е тръгнало ново зареждане —
 * иначе бърз преход между два класа може да покаже данните на предишния.
 */
export function useAsync(loader, deps = []) {
    const [state, setState] = useState({ data: null, error: '', loading: true });
    const runId = useRef(0);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const reload = useCallback(async () => {
        const id = ++runId.current;
        setState((s) => ({ ...s, loading: true }));
        try {
            const data = await loader();
            if (alive.current && id === runId.current) setState({ data, error: '', loading: false });
        } catch (err) {
            if (alive.current && id === runId.current) {
                setState({ data: null, error: errorText(err), loading: false });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        reload();
    }, [reload]);

    return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}
