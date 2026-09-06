import { run, rpc, supabase } from './client.js';

const COLUMNS =
    'id, title, subject, grade, class_id, time_per_question, shuffle_questions, questions_per_attempt, is_published, is_practice, archived_at, created_at, updated_at';

/** Тест, който децата още виждат — публикуван и неархивиран. */
export const isActive = (quiz) => Boolean(quiz?.is_published) && !quiz?.archived_at;

/**
 * Колко деца са решили теста и кои още не са.
 *
 * Тестът се архивира сам чак когато всички са го решили, затова учителят
 * трябва да вижда кого чака — например две болни деца, които ще го направят
 * следващата седмица.
 */
export const progress = (quizId) => rpc('quiz_progress', { p_quiz_id: quizId });

/** Пълни данни за един решен тест — за протокола, който се разпечатва. */
export const attemptReport = (attemptId) => rpc('attempt_report', { p_attempt_id: attemptId });

/** Предадените тестове в един клас, за списъка с протоколи. */
export const attemptsByClass = (classId) =>
    run(
        supabase
            .from('attempts')
            .select(
                'id, started_at, finished_at, score, max_score, students!inner(display_name, roll_number, class_id), quizzes(title, subject)'
            )
            .eq('students.class_id', classId)
            .not('finished_at', 'is', null)
            .order('finished_at', { ascending: false })
    );

export const list = () =>
    run(supabase.from('quizzes').select(COLUMNS).order('created_at', { ascending: false }));

export const get = (quizId) => run(supabase.from('quizzes').select(COLUMNS).eq('id', quizId).single());

export const create = ({ teacherId, title, subject, grade, classId }) =>
    run(
        supabase
            .from('quizzes')
            .insert({
                teacher_id: teacherId,
                title: title.trim(),
                subject,
                grade: Number(grade),
                class_id: classId || null,
            })
            .select(COLUMNS)
            .single()
    );

export const update = (quizId, patch) =>
    run(supabase.from('quizzes').update(patch).eq('id', quizId).select(COLUMNS).single());

export const remove = (quizId) => run(supabase.from('quizzes').delete().eq('id', quizId));

/**
 * Изважда тест от архива, за да се решава пак.
 *
 * Внимание: обикновен тест пак ще е достъпен само за децата, които още НЕ са
 * го решавали — правилото „един път“ важи независимо от архива. За повторно
 * решаване от всички отбележи теста като упражнение.
 */
export const unarchive = (quizId) =>
    run(supabase.from('quizzes').update({ archived_at: null }).eq('id', quizId).select(COLUMNS).single());

export const archive = (quizId) =>
    run(
        supabase
            .from('quizzes')
            .update({ archived_at: new Date().toISOString() })
            .eq('id', quizId)
            .select(COLUMNS)
            .single()
    );

/**
 * Публикуването минава през SQL функция, а не през UPDATE, защото базата
 * трябва да провери теста: има ли въпроси, има ли всеки въпрос поне два
 * отговора и точно един верен, избран ли е клас.
 */
export const publish = (quizId, publish = true) =>
    rpc('publish_quiz', { p_quiz_id: quizId, p_publish: publish });

// --- Въпроси и отговори -------------------------------------------------------

export async function listQuestions(quizId) {
    const rows = await run(
        supabase
            .from('questions')
            .select(
                'id, prompt, hint, headline_correct, explanation_correct, headline_wrong, explanation_wrong, image_url, position, points, answers (id, text, is_correct, position)'
            )
            .eq('quiz_id', quizId)
            .order('position')
    );
    // PostgREST не гарантира реда на вложените редове — подреждаме ги тук.
    return rows.map((q) => ({
        ...q,
        answers: [...q.answers].sort((a, b) => a.position - b.position),
    }));
}

/** Създава въпроса и отговорите му. `answers` са вече проверени от викащия. */
export async function addQuestion({ quizId, prompt, hint, headlines, explanations, position, answers }) {
    const question = await run(
        supabase
            .from('questions')
            .insert({
                quiz_id: quizId,
                prompt: prompt.trim(),
                // Празно поле се записва като NULL, а не като празен низ —
                // CHECK ограничението в базата не допуска празен текст.
                hint: hint?.trim() || null,
                headline_correct: headlines?.correct?.trim() || null,
                headline_wrong: headlines?.wrong?.trim() || null,
                explanation_correct: explanations?.correct?.trim() || null,
                explanation_wrong: explanations?.wrong?.trim() || null,
                position,
            })
            .select('id')
            .single()
    );

    await run(
        supabase.from('answers').insert(
            answers.map((a, i) => ({
                question_id: question.id,
                text: a.text.trim(),
                is_correct: a.is_correct,
                position: i,
            }))
        )
    );

    return question;
}

export const removeQuestion = (questionId) =>
    run(supabase.from('questions').delete().eq('id', questionId));

/**
 * Обновява съществуващ въпрос заедно с отговорите му.
 *
 * Отговорите НЕ се трият и създават наново. Причината е, че attempt_answers
 * сочи към answers.id: изтриването би занулило кой отговор е избрало детето и
 * старите резултати биха загубили тази подробност. Затова:
 *   * отговор с `id`   -> обновява се на място,
 *   * отговор без `id` -> добавя се,
 *   * липсващ в списъка -> трие се.
 */
export async function updateQuestion({ questionId, prompt, hint, headlines, explanations, answers }) {
    await run(
        supabase
            .from('questions')
            .update({
                prompt: prompt.trim(),
                hint: hint?.trim() || null,
                headline_correct: headlines?.correct?.trim() || null,
                headline_wrong: headlines?.wrong?.trim() || null,
                explanation_correct: explanations?.correct?.trim() || null,
                explanation_wrong: explanations?.wrong?.trim() || null,
            })
            .eq('id', questionId)
    );

    const existing = await run(supabase.from('answers').select('id').eq('question_id', questionId));

    const kept = new Set(answers.filter((a) => a.id).map((a) => a.id));
    const removed = existing.filter((a) => !kept.has(a.id)).map((a) => a.id);

    if (removed.length > 0) {
        await run(supabase.from('answers').delete().in('id', removed));
    }

    for (const [i, a] of answers.entries()) {
        const row = { text: a.text.trim(), is_correct: a.is_correct, position: i };
        if (a.id) {
            await run(supabase.from('answers').update(row).eq('id', a.id));
        } else {
            await run(supabase.from('answers').insert({ ...row, question_id: questionId }));
        }
    }
}

/**
 * Проверява черновата на въпрос преди запис. Същите правила важат и в базата
 * (publish_quiz), но тук връщат разбираемо съобщение веднага, без обиколка
 * до сървъра.
 */
export function validateQuestionDraft(draft) {
    // Празните редове от формата се пренебрегват; `id` се пази, за да може
    // updateQuestion да обнови съществуващите отговори на място.
    const filled = draft.answers.filter((a) => a.text.trim().length > 0);

    if (!draft.prompt.trim()) return { error: 'Напиши въпроса.' };
    if (filled.length < 2) return { error: 'Въпросът трябва да има поне 2 попълнени отговора.' };
    if (filled.filter((a) => a.is_correct).length !== 1) {
        return { error: 'Отбележи точно един верен отговор.' };
    }
    return { answers: filled };
}
