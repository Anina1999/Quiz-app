import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api/index.js';
import { errorText } from '../lib/supabase.js';

/**
 * Логиката на самия тест, отделена от изгледа.
 *
 * Състояния:
 *   loading   — тече start_attempt
 *   answering — въпросът е на екрана, таймерът върви
 *   revealed  — отговорено (или времето е изтекло), верният отговор се вижда
 *   done      — тестът е приключен, има резултат
 *   error     — опитът не можа да започне
 *
 * Оценяването НЕ е тук — прави се от базата в submit_answer(). Затова
 * `question.answers` не съдържа поле is_correct и никое дете не може да
 * прочете верния отговор от кода на страницата.
 */
export function useQuizGame({ studentId, quizId, onFeedback }) {
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const [payload, setPayload] = useState(null);
    const [index, setIndex] = useState(0);
    const [verdict, setVerdict] = useState(null);
    const [score, setScore] = useState(0);
    const [result, setResult] = useState(null);
    const [timeLeft, setTimeLeft] = useState(0);
    // Секунди до края на гратиса след затваряне на класа. null = часът тече.
    const [graceSeconds, setGraceSeconds] = useState(null);

    const startedRef = useRef(false);
    const askedAtRef = useRef(0);

    const questions = payload?.questions ?? [];
    const question = questions[index] ?? null;
    const total = questions.length;
    const isLast = total > 0 && index === total - 1;

    // --- Стартиране -----------------------------------------------------------
    useEffect(() => {
        // React StrictMode пуска ефектите два пъти в режим на разработка.
        // Без този предпазител се създават два опита в базата.
        if (startedRef.current) return;
        startedRef.current = true;

        (async () => {
            try {
                setPayload(await api.play.startAttempt(studentId, quizId));
                setStatus('answering');
            } catch (err) {
                setError(errorText(err));
                setStatus('error');
            }
        })();
    }, [studentId, quizId]);

    // --- Отговор --------------------------------------------------------------
    const answer = useCallback(
        async (answerId) => {
            if (status !== 'answering' || !question) return;
            setStatus('revealed');

            try {
                const res = await api.play.submitAnswer({
                    attemptId: payload.attempt_id,
                    questionId: question.id,
                    answerId,
                    timeTakenMs: Date.now() - askedAtRef.current,
                });

                // Часът е свършил, докато детето е мислело. Резултатът вече е
                // записан от базата — само го показваме.
                if (res.expired) {
                    setResult({ score: Number(res.score), max_score: Number(res.max_score) });
                    setStatus('done');
                    return;
                }

                setVerdict({
                    isCorrect: res.is_correct,
                    correctId: res.correct_answer_id,
                    pickedId: answerId,
                    timedOut: answerId === null,
                    // Заглавният ред и обяснението идват чак сега, а не при
                    // стартиране на теста — иначе биха подсказали отговора.
                    headline: res.headline,
                    explanation: res.explanation,
                });
                if (res.is_correct) setScore((s) => s + res.points);
                onFeedback?.(res.is_correct);
            } catch (err) {
                setError(errorText(err));
            }
        },
        [status, question, payload, onFeedback]
    );

    // --- Таймер ---------------------------------------------------------------
    useEffect(() => {
        if (status !== 'answering' || !question) return;

        askedAtRef.current = Date.now();

        // time_per_question = NULL означава тест без ограничение във времето.
        // Учителят го избира при създаването на теста.
        const seconds = payload.quiz.time_per_question;
        if (!seconds) {
            setTimeLeft(null);
            return;
        }

        setTimeLeft(seconds);

        const id = setInterval(() => {
            setTimeLeft((t) => {
                if (t > 1) return t - 1;
                clearInterval(id);
                // Времето изтече: записва се „без отговор“ и играта продължава
                // нормално — включително на последния въпрос. (В първата версия
                // тук се показваше бутон „Next“, който на последния въпрос
                // водеше до задънена улица и резултатът не се появяваше.)
                answer(null);
                return 0;
            });
        }, 1000);

        return () => clearInterval(id);
    }, [status, index, question, payload, answer]);

    // --- Гратис след затваряне на класа ---------------------------------------
    /*
     * Когато учителят затвори класа, децата, които още решават, получават 5
     * минути да довършат. Питаме базата на всеки 20 секунди, защото само тя
     * знае кога класът е затворен — браузърът няма как да разбере сам.
     *
     * Ако времето свърши, базата вече е записала резултата; тук само го
     * показваме.
     */
    useEffect(() => {
        if (status !== 'answering' && status !== 'revealed') return;
        if (!payload) return;

        let alive = true;

        const poll = async () => {
            try {
                const res = await api.play.attemptStatus(payload.attempt_id);
                if (!alive) return;

                if (res.finished) {
                    setResult(await api.play.finishAttempt(payload.attempt_id));
                    setStatus('done');
                    return;
                }
                setGraceSeconds(res.seconds_left);
            } catch {
                /* мрежов проблем — пробваме пак след 20 секунди */
            }
        };

        poll();
        const id = setInterval(poll, 20000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [status, payload]);

    // --- Напред ---------------------------------------------------------------
    const next = useCallback(async () => {
        if (!isLast) {
            setVerdict(null);
            setIndex((i) => i + 1);
            setStatus('answering');
            return;
        }
        try {
            setResult(await api.play.finishAttempt(payload.attempt_id));
        } catch (err) {
            setError(errorText(err));
            setResult({ score, max_score: payload.max_score });
        }
        setStatus('done');
    }, [isLast, payload, score]);

    return {
        status,
        error,
        quiz: payload?.quiz ?? null,
        maxScore: payload?.max_score ?? 0,
        hasTimer: Boolean(payload?.quiz?.time_per_question),
        question,
        index,
        total,
        isLast,
        timeLeft,
        graceSeconds,
        verdict,
        score,
        result,
        answer,
        next,
    };
}
