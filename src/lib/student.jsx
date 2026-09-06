import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import * as play from '../api/play.js';

const STORAGE_KEY = 'quiz-app:student';

const StudentContext = createContext(null);

function readStored() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        // Частен прозорец или изключени бисквитки — просто започваме отначало.
        return null;
    }
}

function writeStored(value) {
    try {
        if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* без localStorage приложението пак работи, само не помни избора */
    }
}

/** Истински потребител (учител) — има email. Анонимната сесия няма. */
const isRealUser = (session) => Boolean(session?.user?.email);

/**
 * Ученическата сесия.
 *
 * Детето няма акаунт. Влиза с код на класа и избира псевдонима си от списък.
 * Отдолу стои анонимна Supabase сесия, която служи само за да може базата да
 * различи "това устройство" от другите — никакви лични данни не се събират.
 *
 * ВАЖНО: двете роли се изключват взаимно. На едно устройство или си учител,
 * или си ученик. Иначе детето би работило с учителския JWT и през браузъра би
 * имало учителски достъп до базата.
 */
export function StudentProvider({ children }) {
    const [student, setStudent] = useState(() => readStored());
    const [ready, setReady] = useState(false);

    /*
     * Изходът, докато мрежовата заявка още тече.
     *
     * signOut() не е мигновен. Ако детето натисне „Аз съм ученик“, преди той да
     * е приключил, getSession() в ensureSession() още връща СТАРАТА сесия, нова
     * анонимна не се създава — и миг по-късно signOut() премахва и старата.
     * Формата излиза наглед готова, но първата заявка тръгва без сесия и базата
     * отговаря с „permission denied for function class_preview“, защото вижда
     * роля anon вместо authenticated.
     *
     * Затова ensureSession() изчаква тук, преди изобщо да погледне сесията.
     */
    const signingOut = useRef(null);

    // Ако някой влезе като учител, ученическата сесия отпада.
    useEffect(() => {
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            if (isRealUser(session)) {
                writeStored(null);
                setStudent(null);
                setReady(false);
            }
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    /**
     * Подготвя анонимна сесия за ученическия поток.
     *
     * Викa се чак когато детето отвори екрана за влизане — НЕ при зареждане на
     * приложението. Иначе учителят щеше да бъде изхвърлян при всяко отваряне.
     */
    const ensureSession = useCallback(async () => {
        // Предишният изход може още да тече — виж `signingOut`. Без това
        // изчакване проверката по-долу гледа сесия, която ще изчезне.
        if (signingOut.current) {
            try {
                await signingOut.current;
            } catch {
                /* провален изход: състоянието се проверява наново по-долу */
            }
        }

        const { data } = await supabase.auth.getSession();

        // Учителска сесия на същото устройство: прекратяваме я, преди детето
        // да влезе, за да не наследи неговите права.
        if (isRealUser(data.session)) {
            await supabase.auth.signOut();
        }

        const { data: after } = await supabase.auth.getSession();
        if (!after.session) {
            const { error } = await supabase.auth.signInAnonymously();
            if (error) throw error;
        }

        setReady(true);
    }, []);

    const join = useCallback(async (joinCode, studentId) => {
        const data = await play.claimStudent(joinCode, studentId);

        const next = { ...data.student, class: data.class };
        writeStored(next);
        setStudent(next);
        return next;
    }, []);

    const leave = useCallback(async () => {
        writeStored(null);
        setStudent(null);
        setReady(false);

        // Прекратяваме и анонимната сесия, за да получи следващото дете на
        // същото устройство нова самоличност. Заявката се запомня, за да може
        // ensureSession() да я изчака, ако детето влезе наново веднага.
        const done = supabase.auth.signOut();
        signingOut.current = done;
        try {
            await done;
        } finally {
            if (signingOut.current === done) signingOut.current = null;
        }
    }, []);

    const value = useMemo(
        () => ({ student, ready, ensureSession, join, leave }),
        [student, ready, ensureSession, join, leave]
    );

    return <StudentContext.Provider value={value}>{children}</StudentContext.Provider>;
}

export function useStudent() {
    const ctx = useContext(StudentContext);
    if (!ctx) throw new Error('useStudent трябва да е вътре в <StudentProvider>');
    return ctx;
}
