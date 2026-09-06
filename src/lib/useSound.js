import { useCallback, useEffect, useRef, useState } from 'react';

const MUTE_KEY = 'quiz-app:muted';

function readMuted() {
    try {
        return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * Звуци за верен/грешен отговор, с ключе за заглушаване.
 *
 * В класна стая с 25 деца звукът често пречи, затова изборът се помни на
 * устройството. `play()` връща Promise, който браузърите отхвърлят, докато
 * детето не е кликнало нищо (autoplay политика) — затова го поглъщаме тихо,
 * вместо да оставяме необработена грешка в конзолата.
 */
export function useSound() {
    const correct = useRef(null);
    const wrong = useRef(null);
    const [muted, setMuted] = useState(readMuted);

    useEffect(() => {
        const base = import.meta.env.BASE_URL;
        correct.current = new Audio(`${base}sounds/correct.mp3`);
        wrong.current = new Audio(`${base}sounds/wrong.mp3`);
        for (const a of [correct.current, wrong.current]) {
            a.volume = 0.5;
            a.preload = 'auto';
        }
        return () => {
            for (const a of [correct.current, wrong.current]) a?.pause();
        };
    }, []);

    const toggleMuted = useCallback(() => {
        setMuted((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(MUTE_KEY, next ? '1' : '0');
            } catch {
                /* без localStorage изборът важи само за текущия час */
            }
            return next;
        });
    }, []);

    const play = useCallback(
        (kind) => {
            if (muted) return;
            const audio = kind === 'correct' ? correct.current : wrong.current;
            if (!audio) return;
            audio.currentTime = 0;
            audio.play().catch(() => {
                /* браузърът още не разрешава звук — не е проблем */
            });
        },
        [muted]
    );

    return { play, muted, toggleMuted };
}
