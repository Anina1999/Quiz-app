import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';

const AuthContext = createContext(null);

/**
 * Държи Supabase сесията и профила на учителя.
 *
 * Учениците също имат сесия (анонимна), затова навсякъде проверяваме
 * `isTeacher`, а не просто дали има сесия. Анонимната сесия няма email.
 */
export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [teacher, setTeacher] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        supabase.auth.getSession().then(({ data }) => {
            if (!active) return;
            setSession(data.session ?? null);
            setLoading(false);
        });

        const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next ?? null);
        });

        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, []);

    const userId = session?.user?.id ?? null;
    const isAnonymous = session?.user?.is_anonymous === true || !session?.user?.email;

    useEffect(() => {
        if (!userId || isAnonymous) {
            setTeacher(null);
            return;
        }
        let active = true;
        supabase
            .from('teachers')
            .select('id, email, full_name, school')
            .eq('id', userId)
            .maybeSingle()
            .then(({ data }) => {
                if (active) setTeacher(data ?? null);
            });
        return () => {
            active = false;
        };
    }, [userId, isAnonymous]);

    const value = useMemo(
        () => ({
            session,
            teacher,
            loading,
            isTeacher: Boolean(teacher),

            async signUp({ email, password, fullName, school }) {
                return supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName, school: school || null } },
                });
            },

            async signIn({ email, password }) {
                return supabase.auth.signInWithPassword({ email, password });
            },

            async signOut() {
                setTeacher(null);
                return supabase.auth.signOut();
            },
        }),
        [session, teacher, loading]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth трябва да е вътре в <AuthProvider>');
    return ctx;
}
