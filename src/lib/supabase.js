import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    throw new Error(
        'Липсват VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. ' +
            'Копирай .env.example като .env.local и попълни стойностите от Supabase.'
    );
}

export const supabase = createClient(url, anonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
    },
});

/**
 * Съобщенията за грешка от базата са написани на български и са предназначени
 * за учителя. Тази функция ги вади от различните форми, в които supabase-js
 * връща грешка, и дава разбираем резервен текст.
 */
export function errorText(error, fallback = 'Нещо се обърка. Опитай пак.') {
    if (!error) return fallback;
    const raw = error.message ?? String(error);

    if (/Failed to fetch|NetworkError/i.test(raw)) {
        return 'Няма връзка с интернет. Провери мрежата и опитай пак.';
    }
    if (/Invalid login credentials/i.test(raw)) {
        return 'Грешен email или парола.';
    }
    if (/Email not confirmed/i.test(raw)) {
        return 'Потвърди регистрацията от писмото, което ти изпратихме.';
    }
    if (/User already registered/i.test(raw)) {
        return 'Вече има регистрация с този email. Влез с паролата си.';
    }
    if (/Password should be at least/i.test(raw)) {
        return 'Паролата трябва да е поне 8 знака.';
    }
    if (/Anonymous sign-ins are disabled/i.test(raw)) {
        return 'Анонимното влизане е изключено в Supabase. Включи го от Authentication → Providers.';
    }
    if (/duplicate key .*students_class_id_display_name/i.test(raw)) {
        return 'Вече има ученик с този псевдоним в класа.';
    }
    if (/duplicate key .*students_class_id_roll_number/i.test(raw)) {
        return 'Вече има ученик с този номер в класа.';
    }
    return raw || fallback;
}
