/**
 * Малките градивни части, които се повтаряха дословно по страниците.
 *
 * Целта не е „компонент за всичко“, а да няма два различни начина да се покаже
 * грешка или да се направи поле — това е и мястото, където достъпността се
 * прилага веднъж за целия проект (role="alert", свързан label, aria-live).
 */
import { Link } from 'react-router-dom';

/** Съобщение. `kind`: 'error' | 'ok' | 'info'. */
export function Alert({ kind = 'info', children }) {
    if (!children) return null;
    return (
        // role="alert" прекъсва екранния четец веднага — за грешка е правилно.
        // Успехът и подсказката се четат учтиво, след текущото изречение.
        <p className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
            {children}
        </p>
    );
}

/** Показва грешка и/или съобщение за успех от useFeedback. */
export function Feedback({ error, notice }) {
    return (
        <>
            <Alert kind="error">{error}</Alert>
            <Alert kind="ok">{notice}</Alert>
        </>
    );
}

export function Loading({ children = 'Зареждане…' }) {
    return (
        <p className="page" role="status">
            {children}
        </p>
    );
}

/**
 * Поле с етикет. `<label>` обгръща контрола, затова връзката етикет–поле е
 * налична и без id/htmlFor — по-малко код и невъзможно за разваляне.
 */
export function Field({ label, hint, children, style }) {
    return (
        <label className="field" style={style}>
            <span className="field__label">
                {label}
                {hint && <span className="field__hint">{hint}</span>}
            </span>
            {children}
        </label>
    );
}

/** Поле за въвеждане с етикет. */
export function TextField({ label, hint, style, ...inputProps }) {
    return (
        <Field label={label} hint={hint} style={style}>
            <input {...inputProps} />
        </Field>
    );
}

/** Падащо меню с етикет. `options` е масив от стойности или { value, label }. */
export function SelectField({ label, hint, options, style, ...selectProps }) {
    return (
        <Field label={label} hint={hint} style={style}>
            <select {...selectProps}>
                {options.map((o) => {
                    const value = typeof o === 'object' ? o.value : o;
                    const text = typeof o === 'object' ? o.label : o;
                    return (
                        <option key={String(value)} value={value}>
                            {text}
                        </option>
                    );
                })}
            </select>
        </Field>
    );
}

export function Badge({ kind, children }) {
    return <span className={kind ? `badge badge--${kind}` : 'badge'}>{children}</span>;
}

/**
 * Състоянието на един тест с една значка.
 *
 * Редът на проверките е важен: архивиран тест не се показва на децата, дори
 * да е публикуван — затова архивът е първи.
 */
export function QuizBadge({ quiz }) {
    if (quiz.archived_at) return <Badge kind="muted">В архива</Badge>;
    if (!quiz.is_published) return <Badge kind="muted">Чернова</Badge>;
    if (quiz.is_practice) return <Badge kind="ok">Упражнение</Badge>;
    return <Badge kind="ok">Публикуван</Badge>;
}

/**
 * Стрелка назад — цял бутон, не текстова връзка.
 *
 * Ползва се по екраните, до които се стига от началния („Кой си ти?“): вход за
 * учители и влизане на ученик. Размерът е на бутон (56px), защото на детските
 * екрани пръст върху таблет не улучва ред текст.
 *
 * С `to` е връзка към адрес, с `onClick` — връщане една стъпка назад в рамките
 * на същия екран. Стои винаги горе вляво, за да е на едно и също място.
 */
export function BackButton({ to, onClick, children = 'Назад' }) {
    if (to) {
        return (
            <Link to={to} className="btn btn--secondary">
                ← {children}
            </Link>
        );
    }
    return (
        <button type="button" className="btn btn--secondary" onClick={onClick}>
            ← {children}
        </button>
    );
}

export function BackLink({ to = '/teacher', children = '← Обратно към таблото' }) {
    return (
        <p className="small">
            <Link to={to}>{children}</Link>
        </p>
    );
}

/** Лента за напредък с текстово описание за екранни четци. */
export function ProgressBar({ percent, label }) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    return (
        <div className="progressbar" role="img" aria-label={label}>
            <div className="progressbar__fill" style={{ width: `${value}%` }} />
        </div>
    );
}
