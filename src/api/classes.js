import { run, rpc, supabase } from './client.js';

const COLUMNS = 'id, name, grade, join_code, archived, joining_open_until, created_at';

/** Един учебен час. Стойност по подразбиране при отваряне на влизането. */
export const LESSON_MINUTES = 45;

export const list = () =>
    run(supabase.from('classes').select(COLUMNS).order('grade').order('name'));

export const get = (classId) =>
    run(supabase.from('classes').select(COLUMNS).eq('id', classId).single());

/** join_code се генерира от базата (DEFAULT generate_join_code()). */
export const create = ({ teacherId, name, grade }) =>
    run(
        supabase
            .from('classes')
            .insert({ teacher_id: teacherId, name: name.trim(), grade: Number(grade) })
            .select(COLUMNS)
            .single()
    );

export const remove = (classId) => run(supabase.from('classes').delete().eq('id', classId));

/** Нов код за дъската — старият спира да важи веднага. */
export const newJoinCode = (classId) => rpc('regenerate_join_code', { p_class_id: classId });

/** Освобождава всички псевдоними — за начало на нов час. Връща броя. */
export const resetSessions = (classId) => rpc('reset_class_sessions', { p_class_id: classId });

/**
 * Отваря класа за `minutes` минути.
 *
 * Времето се избира ВЕДНЪЖ. Часът не може да се удължава, нито да се затваря
 * по-рано — иначе децата не знаят докога решават, а „още 5 минути“ се
 * превръща в безкраен час.
 */
export const open = (classId, minutes = LESSON_MINUTES) =>
    rpc('open_class', { p_class_id: classId, p_minutes: minutes });

/**
 * Разрешава още 5 минути на децата, които не са успели да довършат.
 * Възможно е само след изтичане на часа и само веднъж.
 */
export const grantGrace = (classId) => rpc('grant_grace', { p_class_id: classId });

/** Състоянието на часа: фаза, оставащи секунди, колко деца още решават. */
export const lessonState = (classId) => rpc('class_lesson_state', { p_class_id: classId });

/** Отворен ли е класът за влизане в момента. */
export const isJoiningOpen = (klass) =>
    Boolean(klass?.joining_open_until) && new Date(klass.joining_open_until) > new Date();

/** Напредък по ученик и по учебен предмет (изглед class_progress). */
export const progress = (classId) =>
    run(supabase.from('class_progress').select('*').eq('class_id', classId));
