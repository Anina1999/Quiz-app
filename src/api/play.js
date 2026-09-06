import { rpc } from './client.js';

/**
 * Ученическият поток.
 *
 * Всичко тук минава през SQL функции, а не през таблици — учениците нямат
 * пряк достъп до нито една таблица. Оценяването също е в базата: браузърът
 * никога не получава кой отговор е верен, преди детето да е отговорило.
 */

/** Класът и псевдонимите в него, по код от дъската. */
export const classPreview = (joinCode) =>
    rpc('class_preview', { p_join_code: joinCode.trim().toUpperCase() });

/** Детето „заема“ псевдоним за този урок. */
export const claimStudent = (joinCode, studentId) =>
    rpc('claim_student', { p_join_code: joinCode.trim().toUpperCase(), p_student_id: studentId });

/** Публикуваните тестове за класа + личният най-добър резултат. */
export const myQuizzes = (studentId) => rpc('student_quizzes', { p_student_id: studentId });

/** Личният напредък по учебен предмет. */
export const myProgress = (studentId) => rpc('student_progress', { p_student_id: studentId });

/** Стартира опит и връща въпросите — без полето is_correct. */
export const startAttempt = (studentId, quizId) =>
    rpc('start_attempt', { p_student_id: studentId, p_quiz_id: quizId });

/** Оценява един отговор. `answerId === null` означава „времето изтече“. */
export const submitAnswer = ({ attemptId, questionId, answerId, timeTakenMs }) =>
    rpc('submit_answer', {
        p_attempt_id: attemptId,
        p_question_id: questionId,
        p_answer_id: answerId,
        p_time_taken_ms: Math.max(0, Math.round(timeTakenMs ?? 0)),
    });

/** Приключва опита и връща окончателния резултат. */
export const finishAttempt = (attemptId) => rpc('finish_attempt', { p_attempt_id: attemptId });

/**
 * Колко време остава на детето, след като учителят е затворил класа.
 *
 * `seconds_left: null` означава, че часът още тече и няма ограничение.
 * Ако гратисът е изтекъл, базата сама приключва опита и записва резултата —
 * така той не се губи, дори детето да не натисне нищо.
 */
export const attemptStatus = (attemptId) => rpc('attempt_status', { p_attempt_id: attemptId });
