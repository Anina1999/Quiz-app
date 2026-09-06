import { run, supabase } from './client.js';

// Умишлено НЕ съществуват полета за име, фамилия или email — приложението не
// събира лични данни на деца. Виж коментара към таблицата в схемата.
const COLUMNS = 'id, display_name, roll_number, session_uid';

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
