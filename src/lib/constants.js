// Учебните предмети трябва да съвпадат ТОЧНО със списъка в CHECK ограничението
// на quizzes.subject (виж supabase/migrations/..._schema.sql). Ако добавиш нов
// предмет тук, добави го и с миграция в базата.
export const SUBJECTS = [
    'Математика',
    'Български език и литература',
    'Околен свят',
    'Човекът и природата',
    'Човекът и обществото',
    'Английски език',
    'Друго',
];

export const GRADES = [1, 2, 3, 4];

/** Опции за <SelectField> — „1.“, „2.“ … */
export const gradeOptions = () => GRADES.map((g) => ({ value: g, label: `${g}.` }));

/** Опции за <SelectField> от списък класове, с празен избор отпред. */
export const classOptions = (classes) => [
    { value: '', label: '— избери —' },
    ...classes.map((c) => ({ value: c.id, label: `${c.grade}. клас · ${c.name}` })),
];

/**
 * „2А клас“ — както се казва в училище.
 *
 * Името на класа вече носи и цифрата, затова „2. клас · 2А“ е повторение.
 * Падащите менюта остават с `classOptions`, където групирането по година
 * помага при много класове.
 */
export const classLabel = (klass) => (klass ? `${klass.name} клас` : '');
