import { run, rpc, supabase } from './client.js';

// Умишлено НЕ съществуват полета за име, фамилия или email — приложението не
// събира лични данни на деца. Виж коментара към таблицата в схемата.
const COLUMNS = 'id, display_name, roll_number, session_uid, absent_since, absent_for_lesson';

export const listByClass = (classId) =>
    run(
        supabase
            .from('students')
            .select(COLUMNS)
            .eq('class_id', classId)
            .order('roll_number', { nullsFirst: false })
            .order('display_name')
    );

export const create = ({ classId, displayName, rollNumber }) =>
    run(
        supabase
            .from('students')
            .insert({
                class_id: classId,
                display_name: displayName.trim(),
                roll_number: rollNumber ? Number(rollNumber) : null,
            })
            .select(COLUMNS)
            .single()
    );

export const remove = (studentId) => run(supabase.from('students').delete().eq('id', studentId));

/**
 * Отсъства от училище — за неопределено време, до връщане.
 *
 * НЕ изтича само. Ако изтичаше на другия ден, болното дете щеше да е
 * „присъстващо“ по подразбиране и щеше да реши теста от леглото.
 *
 * Отсъстващото дете МОЖЕ да влезе в класа с кода, но не може да започне тест.
 * Проверката е в базата (`start_attempt`), не тук: детето вкъщи има същото
 * приложение, затова скрит бутон не е защита.
 */
export const setAbsent = (studentId, absent) =>
    rpc('set_absent', { p_student_id: studentId, p_absent: absent });

/**
 * Няма го в ТОЗИ час — на училище е, но този час е другаде.
 *
 * Важи само за текущия час; следващият го отваря отново. Изисква отворен час.
 */
export const setAbsentThisLesson = (studentId, absent) =>
    rpc('set_absent_this_lesson', { p_student_id: studentId, p_absent: absent });

/** Отсъства от училище (безсрочно, до връщане). */
export const isAbsent = (student) => Boolean(student?.absent_since);

/** Няма го точно в текущия час на класа. */
export const isAbsentThisLesson = (student, klass) =>
    Boolean(
        klass?.joining_open_until &&
            student?.absent_for_lesson &&
            new Date(student.absent_for_lesson).getTime() ===
                new Date(klass.joining_open_until).getTime()
    );

/** Колко дни го няма. 0 означава „отбелязано днес“. */
export const absentForDays = (student) => {
    if (!student?.absent_since) return 0;
    const since = new Date(`${student.absent_since}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today - since) / 86400000));
};

/**
 * Една учебна седмица. След нея отсъствието се показва предупредително.
 *
 * Не защото е нередно — дете може да боледува и три седмици. А защото толкова
 * дълга отметка заслужава втори поглед: или наистина го няма, или някой е
 * забравил да отбележи връщането, а тестовете стоят заключени.
 */
export const LONG_ABSENCE_DAYS = 7;

export const isLongAbsence = (student) => absentForDays(student) >= LONG_ABSENCE_DAYS;

/**
 * „Отсъства · днес“ · „Отсъства · 1 ден“ · „Отсъства · 10 дни“.
 *
 * Единицата иска друга форма: „1 дни“ е грешно.
 */
export const absentLabel = (student) => {
    const days = absentForDays(student);
    if (days === 0) return 'Отсъства · днес';
    return `Отсъства · ${days} ${days === 1 ? 'ден' : 'дни'}`;
};

/** „от 26.08.2026 г.“ — точната дата, за подсказка при посочване. */
export const absentSinceLabel = (student) => {
    if (!student?.absent_since) return '';
    return `Отсъства от ${new Date(`${student.absent_since}T00:00:00`).toLocaleDateString('bg-BG')}`;
};

/**
 * Освобождава псевдонима на един ученик.
 *
 * Нужно е, когато детето смени устройството по средата на часа: старото още
 * "държи" псевдонима и новото получава „вече е зает“. Иначе трябва да се чака
 * изтичането на шестте часа или да се освободи целият клас.
 *
 * Минава през обикновен UPDATE, а не през SQL функция — RLS политиката
 * students_update_own_class вече ограничава учителя до неговите класове.
 */
export const releaseSession = (studentId) =>
    run(
        supabase
            .from('students')
            .update({ session_uid: null, session_claimed_at: null })
            .eq('id', studentId)
    );
