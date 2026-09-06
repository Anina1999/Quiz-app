/**
 * Един бутон с отговор.
 *
 * Достъпност: след разкриване верният отговор носи ✓, а сгрешеният ✗ — същата
 * информация, която носи и цветът. Дете, което не различава зелено от червено,
 * пак разбира какво е станало. Скритият текст казва същото и на екранния четец.
 */
export function AnswerButton({ answer, verdict, revealed, onPick }) {
    const isCorrect = revealed && answer.id === verdict?.correctId;
    const isWrongPick = revealed && answer.id === verdict?.pickedId && !verdict?.isCorrect;

    const className = [
        'answer',
        isCorrect && 'answer--correct',
        isWrongPick && 'answer--wrong',
        revealed && !isCorrect && !isWrongPick && 'answer--dim',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <button type="button" className={className} onClick={() => onPick(answer.id)} disabled={revealed}>
            <span className="answer__mark" aria-hidden="true">
                {isCorrect ? '✓' : isWrongPick ? '✗' : ''}
            </span>
            <span>{answer.text}</span>
            {isCorrect && <span className="sr-only"> — верен отговор</span>}
            {isWrongPick && <span className="sr-only"> — твоят отговор, грешен</span>}
        </button>
    );
}

/**
 * Съобщението след отговора.
 *
 * Текстът на обяснението е изцяло на учителя — той пише отделно какво да види
 * детето при верен и при грешен отговор. Тук не се добавя увод, за да не се
 * бие с неговия тон.
 *
 * Базата решава кое от двете обяснения да изпрати (submit_answer). При изтекло
 * време идва това за грешен отговор — детето не е отговорило и има нужда точно
 * от насоката.
 */
export function Verdict({ verdict }) {
    if (!verdict) return null;

    const { timedOut, isCorrect, explanation } = verdict;

    const kind = timedOut ? 'timeout' : isCorrect ? 'ok' : 'bad';
    const emoji = timedOut ? '⏰' : isCorrect ? '👍' : '👎';

    // Заглавният ред идва от базата — учителят го е написал („Отлично!“).
    // При изтекло време казваме своето: „Не позна“ би било неточно, детето
    // просто не е успяло да отговори.
    const headline = timedOut
        ? 'Времето свърши. Виж кой е верният отговор.'
        : verdict.headline;

    return (
        <div className={`verdict verdict--${kind}`}>
            <span className="verdict__emoji" aria-hidden="true">
                {emoji}
            </span>
            <span>
                <span className="verdict__headline">{headline}</span>
                {explanation && <span className="verdict__explanation">{explanation}</span>}
            </span>
        </div>
    );
}
