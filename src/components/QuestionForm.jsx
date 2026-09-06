import { Field } from './ui.jsx';

/** Толкова реда за отговори показваме винаги — празните се пренебрегват. */
const ANSWER_SLOTS = 4;

/** Стойностите, които базата слага, ако учителят остави полето празно. */
export const DEFAULT_HEADLINE_CORRECT = 'Браво, вярно!';
export const DEFAULT_HEADLINE_WRONG = 'Не позна. Верният отговор е отбелязан.';

const HEADLINE_IDEAS_CORRECT = ['Браво, вярно!', 'Точно така!', 'Отлично!', 'Супер си!'];
const HEADLINE_IDEAS_WRONG = [
    'Не позна. Верният отговор е отбелязан.',
    'Почти! Виж верния отговор.',
    'Няма страшно — виж как е правилно.',
];

export const emptyDraft = () => ({
    prompt: '',
    hint: '',
    headline_correct: '',
    explanation_correct: '',
    headline_wrong: '',
    explanation_wrong: '',
    answers: Array.from({ length: ANSWER_SLOTS }, (_, i) => ({
        text: '',
        is_correct: i === 0,
    })),
});

/**
 * Превръща записан въпрос в чернова за формата.
 *
 * Пази `id` на съществуващите отговори: при запис те се обновяват на място,
 * вместо да се трият и създават наново. Така вече дадените отговори на децата
 * остават свързани с тях в attempt_answers.
 */
export function toDraft(question) {
    const answers = question.answers.map((a) => ({
        id: a.id,
        text: a.text,
        is_correct: a.is_correct,
    }));

    while (answers.length < ANSWER_SLOTS) {
        answers.push({ text: '', is_correct: false });
    }

    return {
        prompt: question.prompt,
        hint: question.hint ?? '',
        headline_correct: question.headline_correct ?? '',
        explanation_correct: question.explanation_correct ?? '',
        headline_wrong: question.headline_wrong ?? '',
        explanation_wrong: question.explanation_wrong ?? '',
        answers,
    };
}

/**
 * Формата за въпрос — една и съща при добавяне и при редактиране.
 *
 * `name` на радио бутоните включва id-то на формата, защото на страницата може
 * да има две форми едновременно (редактиране на един въпрос и добавяне на нов).
 * Без това двете групи биха се смятали за една.
 */
export function QuestionForm({ formId, draft, onChange, onSubmit, onCancel, busy, submitLabel }) {
    const setCorrect = (i) =>
        onChange({
            ...draft,
            answers: draft.answers.map((a, j) => ({ ...a, is_correct: i === j })),
        });

    const setText = (i, text) =>
        onChange({
            ...draft,
            answers: draft.answers.map((a, j) => (i === j ? { ...a, text } : a)),
        });

    return (
        <form className="card stack" onSubmit={onSubmit}>
            <Field label="Въпрос">
                <textarea
                    value={draft.prompt}
                    onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
                    placeholder="напр. Колко е 7 + 5?"
                    required
                    maxLength={500}
                />
            </Field>

            {/* Подсказката се вижда ПРЕДИ отговора, точно под въпроса — за
                разлика от обясненията, които идват след него. */}
            <Field
                label="Подсказка под въпроса"
                hint="по избор — детето я вижда, преди да отговори, затова не бива да издава отговора"
            >
                <input
                    value={draft.hint}
                    onChange={(e) => onChange({ ...draft, hint: e.target.value })}
                    placeholder="напр. Не бързай, пресметни. Използвай сметало."
                    maxLength={300}
                />
            </Field>

            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label">
                    Отговори
                    <span className="field__hint">попълни поне два и отбележи кой е верният</span>
                </legend>
                <div className="stack">
                    {draft.answers.map((a, i) => (
                        <div className="row" key={a.id ?? `new-${i}`}>
                            <input
                                type="radio"
                                name={`correct-${formId}`}
                                checked={a.is_correct}
                                onChange={() => setCorrect(i)}
                                aria-label={`Отговор ${i + 1} е верният`}
                            />
                            <input
                                style={{ flex: 1 }}
                                value={a.text}
                                onChange={(e) => setText(i, e.target.value)}
                                placeholder={`Отговор ${i + 1}`}
                                maxLength={200}
                                aria-label={`Текст на отговор ${i + 1}`}
                            />
                        </div>
                    ))}
                </div>
            </fieldset>

            {/* Двата случая искат различен текст: при верен отговор потвърждаваш
                разсъждението, при грешен показваш къде се е объркало детето.
                И двете полета са по избор. */}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label">
                    Обяснение след отговора
                    <span className="field__hint">
                        по избор — детето го вижда, след като вече е отговорило и не може да се поправи
                    </span>
                </legend>

                <div className="stack">
                    <Field label="✓ Когато отговори вярно">
                        {/* Заглавният ред е този, който детето вижда удебелен.
                            Празно поле означава стойността по подразбиране. */}
                        <input
                            list={`headlines-ok-${formId}`}
                            value={draft.headline_correct}
                            onChange={(e) => onChange({ ...draft, headline_correct: e.target.value })}
                            placeholder={DEFAULT_HEADLINE_CORRECT}
                            maxLength={100}
                            aria-label="Заглавен ред при верен отговор"
                        />
                        <datalist id={`headlines-ok-${formId}`}>
                            {HEADLINE_IDEAS_CORRECT.map((t) => (
                                <option key={t} value={t} />
                            ))}
                        </datalist>
                        <textarea
                            style={{ marginTop: 8 }}
                            value={draft.explanation_correct}
                            onChange={(e) =>
                                onChange({ ...draft, explanation_correct: e.target.value })
                            }
                            placeholder="Обяснение — напр. 2 × 8 = 16. Можеш да броиш на двойки 8 пъти."
                            maxLength={500}
                            aria-label="Обяснение при верен отговор"
                        />
                    </Field>

                    <Field
                        label="✗ Когато сгреши"
                        hint="показва се и когато времето изтече, без детето да отговори"
                    >
                        <input
                            list={`headlines-bad-${formId}`}
                            value={draft.headline_wrong}
                            onChange={(e) => onChange({ ...draft, headline_wrong: e.target.value })}
                            placeholder={DEFAULT_HEADLINE_WRONG}
                            maxLength={200}
                            aria-label="Заглавен ред при грешен отговор"
                        />
                        <datalist id={`headlines-bad-${formId}`}>
                            {HEADLINE_IDEAS_WRONG.map((t) => (
                                <option key={t} value={t} />
                            ))}
                        </datalist>
                        <textarea
                            style={{ marginTop: 8 }}
                            value={draft.explanation_wrong}
                            onChange={(e) => onChange({ ...draft, explanation_wrong: e.target.value })}
                            placeholder="Обяснение — напр. 2 × 6 означава „2 пъти по 6“."
                            maxLength={500}
                            aria-label="Обяснение при грешен отговор"
                        />
                    </Field>
                </div>
            </fieldset>

            <div className="row">
                <button type="submit" className="btn" disabled={busy}>
                    {busy ? 'Записвам…' : submitLabel}
                </button>
                {onCancel && (
                    <button type="button" className="btn btn--quiet" onClick={onCancel}>
                        Откажи
                    </button>
                )}
            </div>
        </form>
    );
}
