import { supabase } from '../lib/supabase.js';

/**
 * supabase-js връща `{ data, error }` вместо да хвърля. Заради това всяка
 * заявка в страницата се придружаваше от три реда проверка. Тези две обвивки
 * превръщат грешката в изключение, за да остане проверката на едно място —
 * в `useAsync` / `try…catch` на страницата.
 */

/** Обвива заявка към таблица или изглед. */
export async function run(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

/** Обвива извикване на SQL функция (RPC). */
export async function rpc(name, args = {}) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data;
}

export { supabase };
