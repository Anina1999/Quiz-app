/**
 * Проверка от край до край срещу ЛОКАЛНА Supabase инстанция.
 *
 *   npx supabase start
 *   node scripts/smoke-test.mjs
 *
 * Прави две неща:
 *   1. Изиграва целия сценарий — учител създава клас, ученици, тест с въпроси,
 *      публикува го; после дете влиза с кода, решава и получава резултат.
 *   2. Опитва се да пробие защитата откъм ученическата (анонимна) сесия и
 *      откъм чужд учител. Всеки такъв опит ТРЯБВА да се провали.
 *
 * Скриптът НЕ пипа облачния проект — ползва само локалните ключове от
 * `supabase status`.
 */
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

// --- Помощни -----------------------------------------------------------------
let passed = 0;
let failed = 0;

function ok(label) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}

function bad(label, detail) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    if (detail) console.log(`      ${detail}`);
}

function check(label, condition, detail) {
    condition ? ok(label) : bad(label, detail);
}

/** Твърди, че операцията е БЛОКИРАНА — или с грешка, или с празен резултат. */
function checkBlocked(label, { data, error }) {
    const blocked = Boolean(error) || data === null || (Array.isArray(data) && data.length === 0);
    check(label, blocked, blocked ? '' : `върна ${JSON.stringify(data).slice(0, 120)}`);
}

function localConfig() {
    const out = execSync('npx supabase status -o env', { encoding: 'utf8' });
    const get = (key) => out.match(new RegExp(`^${key}="?([^"\\n]+)"?$`, 'm'))?.[1];
    return { url: get('API_URL'), anonKey: get('ANON_KEY'), serviceKey: get('SERVICE_ROLE_KEY') };
}

const { url, anonKey, serviceKey } = localConfig();
if (!url || !anonKey) {
    console.error('Не намерих локалните ключове. Пусни първо: npx supabase start');
    process.exit(1);
}

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });

/**
 * Клиент със service_role — ползва се САМО за да симулира изминало време.
 * Тестът не може да чака 45 минути, а учителят вече няма право да затваря
 * часа по-рано, така че изтичането се наглася отвън.
 */
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * Премества часа в миналото, все едно времето е изтекло.
 *
 * Ако е даван гратис, той също отива в миналото — но НЕ се зануляван.
 * Разликата е съществена: зануляването би симулирало „гратис не е даван“ и
 * би скрило правилото, че нов час може да се отвори чак СЛЕД изтичането му.
 */
async function expireLesson(classId) {
    const { data } = await admin.from('classes').select('grace_until').eq('id', classId).single();

    return admin
        .from('classes')
        .update({
            joining_open_until: new Date(Date.now() - 10000).toISOString(),
            grace_until: data?.grace_until ? new Date(Date.now() - 5000).toISOString() : null,
        })
        .eq('id', classId);
}
const stamp = Date.now();

// =============================================================================
console.log('\n\x1b[1m1. Учителят създава клас, ученици и тест\x1b[0m');
// =============================================================================
const teacher = fresh();

const signUp = await teacher.auth.signUp({
    email: `uchitel.${stamp}@example.com`,
    password: 'silna-parola-123',
    options: { data: { full_name: 'Мария Петрова', school: 'СУ Тест' } },
});
check('регистрация на учител', !signUp.error, signUp.error?.message);

const teacherId = signUp.data.user.id;

const profile = await teacher.from('teachers').select('*').eq('id', teacherId).single();
check('профилът се създава автоматично от тригера', !!profile.data, profile.error?.message);
check('името идва от метаданните', profile.data?.full_name === 'Мария Петрова');
check('има колона updated_at', profile.data?.updated_at !== undefined);

const klass = await teacher
    .from('classes')
    .insert({ teacher_id: teacherId, name: '2А', grade: 2 })
    .select('*')
    .single();
check('създаване на клас', !!klass.data, klass.error?.message);
check(
    `кодът за влизане се генерира сам (${klass.data?.join_code})`,
    /^[A-Z2-9]{6}$/.test(klass.data?.join_code ?? '')
);
check(
    'кодът е без 0/O/1/I/L, за да не се бърка от деца',
    !/[01OIL]/.test(klass.data?.join_code ?? '')
);

const students = await teacher
    .from('students')
    .insert([
        { class_id: klass.data.id, display_name: 'Ученик 1', roll_number: 1 },
        { class_id: klass.data.id, display_name: 'Ученик 2', roll_number: 2 },
        { class_id: klass.data.id, display_name: 'Ученик 3', roll_number: 3 },
    ])
    .select('*');
check('добавяне на ученици с псевдоними', students.data?.length === 3, students.error?.message);

const quiz = await teacher
    .from('quizzes')
    .insert({
        teacher_id: teacherId,
        class_id: klass.data.id,
        title: 'Събиране до 20',
        subject: 'Математика',
        grade: 2,
        time_per_question: 20,
    })
    .select('*')
    .single();
check('създаване на тест', !!quiz.data, quiz.error?.message);

const qData = [
    {
        prompt: 'Колко е 7 + 5?',
        correct: '12',
        wrong: ['11', '13', '10'],
        explanationCorrect: 'Точно така! 7 + 5 = 12.',
        explanationWrong: 'Допълни 7 до 10, после добави останалите 2.',
    },
    { prompt: 'Колко е 9 + 8?', correct: '17', wrong: ['16', '18', '15'] },
];
for (const [i, q] of qData.entries()) {
    const question = await teacher
        .from('questions')
        .insert({
            quiz_id: quiz.data.id,
            prompt: q.prompt,
            explanation_correct: q.explanationCorrect ?? null,
            explanation_wrong: q.explanationWrong ?? null,
            position: i,
        })
        .select('id')
        .single();
    await teacher.from('answers').insert([
        { question_id: question.data.id, text: q.correct, is_correct: true, position: 0 },
        ...q.wrong.map((t, j) => ({
            question_id: question.data.id,
            text: t,
            is_correct: false,
            position: j + 1,
        })),
    ]);
}
ok('добавени 2 въпроса с по 4 отговора');

// =============================================================================
console.log('\n\x1b[1m2. Публикуването отказва негодни тестове\x1b[0m');
// =============================================================================
const brokenQuiz = await teacher
    .from('quizzes')
    .insert({
        teacher_id: teacherId,
        class_id: klass.data.id,
        title: 'Празен тест',
        subject: 'Математика',
        grade: 2,
    })
    .select('id')
    .single();

const publishEmpty = await teacher.rpc('publish_quiz', { p_quiz_id: brokenQuiz.data.id });
check(
    'тест без въпроси не може да се публикува',
    !!publishEmpty.error,
    publishEmpty.error ? '' : 'публикува се, а не трябва'
);

const badQ = await teacher
    .from('questions')
    .insert({ quiz_id: brokenQuiz.data.id, prompt: 'Въпрос с два верни', position: 0 })
    .select('id')
    .single();
await teacher.from('answers').insert([
    { question_id: badQ.data.id, text: 'А', is_correct: true, position: 0 },
    { question_id: badQ.data.id, text: 'Б', is_correct: true, position: 1 },
]);
const publishTwoCorrect = await teacher.rpc('publish_quiz', { p_quiz_id: brokenQuiz.data.id });
check(
    'въпрос с два верни отговора спира публикуването',
    !!publishTwoCorrect.error,
    publishTwoCorrect.error?.message
);

const publish = await teacher.rpc('publish_quiz', { p_quiz_id: quiz.data.id, p_publish: true });
check('годният тест се публикува', publish.data?.is_published === true, publish.error?.message);

// --- Таймерът е по избор на учителя ------------------------------------------
const noTimer = await teacher
    .from('quizzes')
    .update({ time_per_question: null })
    .eq('id', quiz.data.id)
    .select('time_per_question')
    .single();
check('тестът може да е без таймер', noTimer.data?.time_per_question === null, noTimer.error?.message);

const withTimer = await teacher
    .from('quizzes')
    .update({ time_per_question: 30 })
    .eq('id', quiz.data.id)
    .select('time_per_question')
    .single();
check('и пак може да се включи', withTimer.data?.time_per_question === 30, withTimer.error?.message);

// =============================================================================
console.log('\n\x1b[1m3. Детето влиза с кода и решава\x1b[0m');
// =============================================================================
const child = fresh();
const anon = await child.auth.signInAnonymously();
check('анонимно влизане', !anon.error, anon.error?.message);

// --- Прозорецът за влизане ----------------------------------------------------
// Класът се създава ЗАТВОРЕН. Само кодът не стига.
checkBlocked(
    'затворен клас не показва списъка с псевдоними',
    await child.rpc('class_preview', { p_join_code: klass.data.join_code })
);

const firstStudentId = (
    await teacher.from('students').select('id').eq('class_id', klass.data.id).limit(1).single()
).data.id;

checkBlocked(
    'затворен клас не пуска влизане дори с верен код',
    await child.rpc('claim_student', {
        p_join_code: klass.data.join_code,
        p_student_id: firstStudentId,
    })
);

const opened = await teacher.rpc('open_class', {
    p_class_id: klass.data.id,
    p_minutes: 45,
});
check('учителят отваря класа за 45 минути', !!opened.data, opened.error?.message);

const preview = await child.rpc('class_preview', { p_join_code: klass.data.join_code });
check('вижда класа по код', preview.data?.class?.name === '2А', preview.error?.message);
check('вижда списък с 3 псевдонима', preview.data?.students?.length === 3);

const wrongCode = await child.rpc('class_preview', { p_join_code: 'ZZZZZZ' });
check('грешен код връща грешка', !!wrongCode.error);

const target = preview.data.students.find((s) => s.display_name === 'Ученик 1');
const claim = await child.rpc('claim_student', {
    p_join_code: klass.data.join_code,
    p_student_id: target.id,
});
check('заема псевдонима си', claim.data?.student?.display_name === 'Ученик 1', claim.error?.message);

const myQuizzes = await child.rpc('student_quizzes', { p_student_id: target.id });
check('вижда публикувания тест', myQuizzes.data?.length === 1, myQuizzes.error?.message);
check('не вижда непубликуваната чернова', !myQuizzes.data?.some((q) => q.title === 'Празен тест'));

const openLesson = await child.rpc('student_lesson_state', { p_student_id: target.id });
check('докато часът тече, детето вижда, че е отворен', openLesson.data?.open === true, JSON.stringify(openLesson.data));
check('в час тестът се води достъпен', myQuizzes.data?.[0]?.can_start === true, JSON.stringify(myQuizzes.data));

// --- Отсъстващото дете не решава от вкъщи ------------------------------------
// Часът ТЕЧЕ, прозорецът е отворен, детето знае кода — но си е вкъщи. Точно
// сценарият, който прозорецът за влизане не покрива.
await teacher.rpc('set_absent', { p_student_id: target.id, p_absent: true });

const absentState = await child.rpc('student_lesson_state', { p_student_id: target.id });
check(
    'отсъстващото дете вижда, че е отбелязано',
    absentState.data?.absent === true && absentState.data?.open === true,
    JSON.stringify(absentState.data)
);
check('причината е „отсъства от училище“', absentState.data?.absent_kind === 'days');

const absentList = await child.rpc('student_quizzes', { p_student_id: target.id });
check(
    'на отсъстващо дете тестът не се води достъпен',
    absentList.data?.every((q) => q.can_start === false),
    JSON.stringify(absentList.data)
);

checkBlocked(
    'отсъстващо дете не може да започне тест, макар часът да тече',
    await child.rpc('start_attempt', { p_student_id: target.id, p_quiz_id: quiz.data.id })
);

// НАЙ-ВАЖНАТА проверка тук: дългото отсъствие НЕ изтича на другия ден. Ако
// изтичаше, болното дете щеше да е „присъстващо“ по подразбиране и щеше да
// реши теста от леглото. Премятаме отметката седмица назад.
await admin
    .from('students')
    .update({ absent_since: '2020-01-01' })
    .eq('id', target.id);

checkBlocked(
    'отсъствието НЕ изтича само — и след дни тестът е заключен',
    await child.rpc('start_attempt', { p_student_id: target.id, p_quiz_id: quiz.data.id })
);

// Детето се връща в клас — тестът пак е негов.
await teacher.rpc('set_absent', { p_student_id: target.id, p_absent: false });
const backList = await child.rpc('student_quizzes', { p_student_id: target.id });
check(
    'след връщане в клас тестът пак е достъпен',
    backList.data?.[0]?.can_start === true,
    JSON.stringify(backList.data)
);

// --- На училище е, но точно този час го няма --------------------------------
await teacher.rpc('set_absent_this_lesson', { p_student_id: target.id, p_absent: true });

const missState = await child.rpc('student_lesson_state', { p_student_id: target.id });
check('причината е „няма го този час“', missState.data?.absent_kind === 'lesson', JSON.stringify(missState.data));

checkBlocked(
    'дете извън този час не може да започне теста му',
    await child.rpc('start_attempt', { p_student_id: target.id, p_quiz_id: quiz.data.id })
);

// Нов час — отметката за миналия час не важи за него. Детето е на училище и
// следващият тест му е достъпен.
await expireLesson(klass.data.id);
await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

const nextLesson = await child.rpc('student_lesson_state', { p_student_id: target.id });
check(
    'при следващия час отметката вече не важи',
    nextLesson.data?.absent === false,
    JSON.stringify(nextLesson.data)
);

const nextList = await child.rpc('student_quizzes', { p_student_id: target.id });
check(
    'следващия час тестът пак е достъпен',
    nextList.data?.[0]?.can_start === true,
    JSON.stringify(nextList.data)
);

checkBlocked(
    'отсъствие от час не се отбелязва, докато час не тече',
    await (async () => {
        await expireLesson(klass.data.id);
        return teacher.rpc('set_absent_this_lesson', { p_student_id: target.id, p_absent: true });
    })()
);

// Връщаме класа в отворено състояние за следващите секции.
await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

const attempt = await child.rpc('start_attempt', {
    p_student_id: target.id,
    p_quiz_id: quiz.data.id,
});
check('стартира опит', !!attempt.data?.attempt_id, attempt.error?.message);
check('получава 2 въпроса', attempt.data?.questions?.length === 2);

// НАЙ-ВАЖНИТЕ проверки за честност на теста:
const leaks = JSON.stringify(attempt.data);
check(
    'верните отговори НЕ се изпращат към браузъра на детето',
    !leaks.includes('is_correct'),
    leaks.includes('is_correct') ? 'в отговора има поле is_correct!' : ''
);
check(
    'обяснението също не изтича предварително',
    !leaks.includes('explanation') && !leaks.includes('Допълни 7 до 10') && !leaks.includes('Точно така'),
    'обяснението често издава верния отговор — не бива да е в start_attempt'
);

// Първи въпрос — отговаря вярно, като първо пита базата кой е верният
// (тук ползваме учителската сесия, само защото сме тест).
// Търсим по текст, а не по индекс: shuffle_questions е включено, затова редът
// е различен при всяко пускане. Взимането на questions[0] правеше теста флаки —
// верният отговор на един въпрос се прилагаше към друг.
const q1 = attempt.data.questions.find((q) => q.prompt === 'Колко е 7 + 5?');
const trueAnswers = await teacher
    .from('answers')
    .select('id, is_correct')
    .in(
        'id',
        q1.answers.map((a) => a.id)
    );
const correctId = trueAnswers.data.find((a) => a.is_correct).id;

const submit1 = await child.rpc('submit_answer', {
    p_attempt_id: attempt.data.attempt_id,
    p_question_id: q1.id,
    p_answer_id: correctId,
    p_time_taken_ms: 3200,
});
check('верен отговор се разпознава', submit1.data?.is_correct === true, submit1.error?.message);
check('връща кой е бил верният отговор', submit1.data?.correct_answer_id === correctId);

// Учителят пише ДВЕ обяснения на въпрос. Базата решава кое да изпрати —
// затова текстът за грешен отговор не стига до детето, когато е отговорило вярно.
const q1HasExplanation = true; // въпросът е избран нарочно — той има обяснения
if (q1HasExplanation) {
    check(
        'при ВЕРЕН отговор идва обяснението за верен',
        submit1.data?.explanation === 'Точно така! 7 + 5 = 12.',
        `получено: ${submit1.data?.explanation}`
    );
    check(
        'обяснението за ГРЕШЕН не изтича при верен отговор',
        !JSON.stringify(submit1.data).includes('Допълни 7 до 10'),
        'детето вижда и двата текста!'
    );
} else {
    check('въпрос без обяснения връща null', submit1.data?.explanation === null);
}

const resubmit = await child.rpc('submit_answer', {
    p_attempt_id: attempt.data.attempt_id,
    p_question_id: q1.id,
    p_answer_id: correctId,
    p_time_taken_ms: 100,
});
check('повторно отговаряне не носи още точки', !resubmit.error);

// Втори въпрос — времето изтича (answer_id = null).
const q2 = attempt.data.questions.find((q) => q.prompt === 'Колко е 9 + 8?');
const timeout = await child.rpc('submit_answer', {
    p_attempt_id: attempt.data.attempt_id,
    p_question_id: q2.id,
    p_answer_id: null,
    p_time_taken_ms: 20000,
});
check('изтекло време се записва без отговор', timeout.data?.is_correct === false, timeout.error?.message);
check('и пак показва верния отговор', !!timeout.data?.correct_answer_id);

// Втори опит, в който детето греши нарочно — за да се провери другият текст.
const retry = await child.rpc('start_attempt', {
    p_student_id: target.id,
    p_quiz_id: quiz.data.id,
});
const retryQ1 = retry.data.questions.find((q) => q.prompt === 'Колко е 7 + 5?');
const wrongId = retryQ1.answers.find((a) => a.id !== correctId).id;

const submitWrong = await child.rpc('submit_answer', {
    p_attempt_id: retry.data.attempt_id,
    p_question_id: retryQ1.id,
    p_answer_id: wrongId,
    p_time_taken_ms: 4000,
});
check(
    'при ГРЕШЕН отговор идва обяснението за грешен',
    submitWrong.data?.explanation === 'Допълни 7 до 10, после добави останалите 2.',
    `получено: ${submitWrong.data?.explanation}`
);
check(
    'обяснението за ВЕРЕН не изтича при грешен отговор',
    !JSON.stringify(submitWrong.data).includes('Точно така'),
    'детето вижда и двата текста!'
);

const finish = await child.rpc('finish_attempt', { p_attempt_id: attempt.data.attempt_id });
check(
    `резултатът е 1 от 2 (получен ${finish.data?.score}/${finish.data?.max_score})`,
    finish.data?.score === 1 && finish.data?.max_score === 2,
    finish.error?.message
);

const progress = await child.rpc('student_progress', { p_student_id: target.id });
check('напредъкът по предмет се смята', progress.data?.[0]?.subject === 'Математика', progress.error?.message);
check('успехът е 50%', Number(progress.data?.[0]?.percent) === 50);

// =============================================================================
console.log('\n\x1b[1m4. Атаки — всяка от тях ТРЯБВА да се провали\x1b[0m');
// =============================================================================
checkBlocked('дете не може да чете таблицата с отговорите', await child.from('answers').select('*'));
checkBlocked('дете не може да изброи класове', await child.from('classes').select('*'));
checkBlocked('дете не може да изброи ученици', await child.from('students').select('*'));
checkBlocked('дете не може да чете чужди резултати', await child.from('attempts').select('*'));
checkBlocked('дете не може да чете въпроси директно', await child.from('questions').select('*'));
checkBlocked('дете не може да чете учителски профили', await child.from('teachers').select('*'));

checkBlocked(
    'дете не може да си направи учителски профил',
    await child.from('teachers').insert({
        id: anon.data.user.id,
        email: 'hacker@example.com',
        full_name: 'Хакер',
    })
);

checkBlocked(
    'дете не може да си запише точки директно',
    await child.from('attempts').insert({
        quiz_id: quiz.data.id,
        student_id: target.id,
        score: 999,
        max_score: 999,
    })
);

const otherStudent = preview.data.students.find((s) => s.display_name === 'Ученик 2');
checkBlocked(
    'дете не може да иска резултатите на съученик',
    await child.rpc('student_progress', { p_student_id: otherStudent.id })
);
checkBlocked(
    'дете не може да стартира тест от името на съученик',
    await child.rpc('start_attempt', { p_student_id: otherStudent.id, p_quiz_id: quiz.data.id })
);

// Втори учител — не трябва да вижда нищо от първия.
const other = fresh();
await other.auth.signUp({
    email: `drug.uchitel.${stamp}@example.com`,
    password: 'silna-parola-123',
    options: { data: { full_name: 'Иван Иванов' } },
});
checkBlocked('чужд учител не вижда класа', await other.from('classes').select('*').eq('id', klass.data.id));
checkBlocked('чужд учител не вижда теста', await other.from('quizzes').select('*').eq('id', quiz.data.id));
checkBlocked('чужд учител не вижда резултатите', await other.from('attempts').select('*'));
checkBlocked(
    'чужд учител не може да публикува чужд тест',
    await other.rpc('publish_quiz', { p_quiz_id: quiz.data.id })
);
checkBlocked(
    'чужд учител не може да смени кода на чужд клас',
    await other.rpc('regenerate_join_code', { p_class_id: klass.data.id })
);

// =============================================================================
console.log('\n\x1b[1m5. Учителят вижда своите резултати\x1b[0m');
// =============================================================================
const teacherView = await teacher.from('class_progress').select('*').eq('class_id', klass.data.id);
check('таблото показва напредъка', teacherView.data?.length === 1, teacherView.error?.message);
check('с псевдонима на детето', teacherView.data?.[0]?.display_name === 'Ученик 1');
check('и с процент успеваемост', Number(teacherView.data?.[0]?.percent) === 50);

// Освобождаване на ОТДЕЛЕН ученик — когато детето смени устройството.
const released = await teacher
    .from('students')
    .update({ session_uid: null, session_claimed_at: null })
    .eq('id', target.id)
    .select('session_uid')
    .single();
check(
    'учителят освобождава един ученик',
    released.data?.session_uid === null,
    released.error?.message
);

checkBlocked(
    'чужд учител не може да освободи ученик',
    await other
        .from('students')
        .update({ session_uid: null })
        .eq('id', otherStudent.id)
        .select('id')
);

checkBlocked(
    'чужд учител не може да отмята отсъствия в чужд клас',
    await other.rpc('set_absent', { p_student_id: otherStudent.id, p_absent: true })
);

// Освободеният псевдоним пак е свободен за избор.
const afterRelease = await child.rpc('class_preview', { p_join_code: klass.data.join_code });
check(
    'освободеният псевдоним пак е свободен',
    afterRelease.data?.students?.find((s) => s.id === target.id)?.is_taken === false,
    afterRelease.error?.message
);

const reset = await teacher.rpc('reset_class_sessions', { p_class_id: klass.data.id });
check('учителят освобождава псевдонимите за нов час', reset.data === 0, reset.error?.message);

// =============================================================================
console.log('\n\x1b[1m6. Затварянето на прозореца спира новите влизания\x1b[0m');
// =============================================================================

// Секция 5 освободи всички псевдоними, затова детето влиза наново.
// Прозорецът още е отворен от по-рано.
//
// Тук ползваме ТРЕТИ ученик: „Ученик 1“ вече реши теста в секция 3, а един
// тест се решава само веднъж.
const third = preview.data.students.find((s) => s.display_name === 'Ученик 3');
const rejoin = await child.rpc('claim_student', {
    p_join_code: klass.data.join_code,
    p_student_id: third.id,
});
check('детето влиза отново, докато класът е отворен', !rejoin.error, rejoin.error?.message);

// Дете, което вече е ВЪТРЕ, не бива да бъде изритано по средата на теста.
const midQuiz = await child.rpc('start_attempt', {
    p_student_id: third.id,
    p_quiz_id: quiz.data.id,
});
check('дете вътре продължава да решава', !!midQuiz.data?.attempt_id, midQuiz.error?.message);

checkBlocked(
    'учителят НЕ може да затвори часа по-рано',
    await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 0 })
);
checkBlocked(
    'учителят НЕ може да удължи текущия час',
    await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 60 })
);
checkBlocked(
    'учителят НЕ може да мести часовника с пряка заявка',
    await teacher
        .from('classes')
        .update({ joining_open_until: new Date(Date.now() + 9e6).toISOString() })
        .eq('id', klass.data.id)
        .select('id')
);

await expireLesson(klass.data.id);
ok('времето на часа изтича');

checkBlocked(
    'след затваряне не се влиза с кода',
    await child.rpc('claim_student', {
        p_join_code: klass.data.join_code,
        p_student_id: firstStudentId,
    })
);
checkBlocked(
    'след затваряне списъкът не се вижда',
    await child.rpc('class_preview', { p_join_code: klass.data.join_code })
);

// Без разрешен от учителя гратис изтичането спира решаването веднага —
// но резултатът НЕ се губи, базата приключва опита сама.
const afterExpiry = await child.rpc('submit_answer', {
    p_attempt_id: midQuiz.data.attempt_id,
    p_question_id: midQuiz.data.questions[0].id,
    p_answer_id: null,
    p_time_taken_ms: 1000,
});
check(
    'без гратис решаването спира при изтичане',
    afterExpiry.data?.expired === true,
    JSON.stringify(afterExpiry.data ?? afterExpiry.error?.message)
);

const savedAnyway = await teacher
    .from('attempts')
    .select('finished_at, score')
    .eq('id', midQuiz.data.attempt_id)
    .single();
check(
    'резултатът се запазва въпреки прекъсването',
    savedAnyway.data?.finished_at !== null,
    savedAnyway.error?.message
);

checkBlocked(
    'чужд учител не може да отвори класа',
    await other.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 })
);

// =============================================================================
console.log('\n\x1b[1m7. Редактиране на вече създаден въпрос\x1b[0m');
// =============================================================================

// Въпрос № 2 беше добавен БЕЗ обяснение — сега учителят му добавя.
const q2row = (
    await teacher
        .from('questions')
        .select('id, explanation_correct, explanation_wrong, answers (id, text, is_correct)')
        .eq('quiz_id', quiz.data.id)
        .eq('position', 1)
        .single()
).data;
check('въпросът е бил без обяснения', q2row.explanation_correct === null && q2row.explanation_wrong === null);

const edited = await teacher
    .from('questions')
    .update({
        prompt: 'Колко е 9 + 8?',
        explanation_correct: 'Браво! 9 + 8 = 17.',
        explanation_wrong: 'Допълни 9 до 10 и добави останалите 7.',
    })
    .eq('id', q2row.id)
    .select('prompt, explanation_correct, explanation_wrong')
    .single();
check(
    'двете обяснения се добавят след време',
    !!edited.data?.explanation_correct && !!edited.data?.explanation_wrong,
    edited.error?.message
);

// Промяна на текста на съществуващ отговор — БЕЗ да се пресъздава редът.
const anAnswer = q2row.answers[0];
const renamed = await teacher
    .from('answers')
    .update({ text: anAnswer.text + ' ' })
    .eq('id', anAnswer.id)
    .select('id')
    .single();
check(
    'отговорът се обновява на място, id-то се запазва',
    renamed.data?.id === anAnswer.id,
    renamed.error?.message
);

// Точно това пази старите резултати: attempt_answers сочи към answers.id.
const history = await teacher
    .from('attempt_answers')
    .select('id, answer_id, is_correct')
    .not('answer_id', 'is', null);
check(
    'старите отговори на децата остават свързани',
    (history.data?.length ?? 0) > 0,
    history.error?.message
);

checkBlocked(
    'чужд учител не може да редактира въпрос',
    await other
        .from('questions')
        .update({ explanation_correct: 'подмяна' })
        .eq('id', q2row.id)
        .select('id')
);

// =============================================================================
console.log('\n\x1b[1m8. Тестът се заключва, докато класът е отворен\x1b[0m');
// =============================================================================

// Класът в момента е ЗАТВОРЕН (секция 6) — редакцията трябва да минава.
const editWhileClosed = await teacher
    .from('questions')
    .update({ hint: 'Не бързай, пресметни. Използвай сметало.' })
    .eq('id', q2row.id)
    .select('hint')
    .single();
check(
    'при затворен клас въпросът се редактира',
    editWhileClosed.data?.hint?.startsWith('Не бързай'),
    editWhileClosed.error?.message
);

await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

checkBlocked(
    'при отворен клас въпросът НЕ се редактира',
    await teacher.from('questions').update({ prompt: 'подмяна' }).eq('id', q2row.id).select('id')
);
checkBlocked(
    'при отворен клас отговор НЕ се редактира',
    await teacher
        .from('answers')
        .update({ text: 'подмяна' })
        .eq('id', q2row.answers[0].id)
        .select('id')
);
checkBlocked(
    'при отворен клас нов въпрос НЕ се добавя',
    await teacher
        .from('questions')
        .insert({ quiz_id: quiz.data.id, prompt: 'нов по време на час', position: 9 })
        .select('id')
);
checkBlocked(
    'при отворен клас заглавието на теста НЕ се сменя',
    await teacher.from('quizzes').update({ title: 'подмяна' }).eq('id', quiz.data.id).select('id')
);

// Публикуването остава позволено — точно него учителят прави в час.
const publishDuringLesson = await teacher.rpc('publish_quiz', {
    p_quiz_id: quiz.data.id,
    p_publish: false,
});
check(
    'скриването на теста в час остава позволено',
    publishDuringLesson.data?.is_published === false,
    publishDuringLesson.error?.message
);
await teacher.rpc('publish_quiz', { p_quiz_id: quiz.data.id, p_publish: true });

// =============================================================================
console.log('\n\x1b[1m9. Пет минути гратис след затваряне\x1b[0m');
// =============================================================================
const graceChild = fresh();
await graceChild.auth.signInAnonymously();
await graceChild.rpc('claim_student', {
    p_join_code: klass.data.join_code,
    p_student_id: otherStudent.id,
});

// Секция 8 отвори нов час, което прибра теста в архива (той вече има решени
// опити). Учителят го връща — иначе никой не може да го започне.
const restored = await teacher
    .from('quizzes')
    .update({ archived_at: null })
    .eq('id', quiz.data.id)
    .select('archived_at')
    .single();
check('учителят връща тест от архива', restored.data?.archived_at === null, restored.error?.message);

const graceAttempt = await graceChild.rpc('start_attempt', {
    p_student_id: otherStudent.id,
    p_quiz_id: quiz.data.id,
});
check('детето започва тест, докато часът тече', !!graceAttempt.data?.attempt_id, graceAttempt.error?.message);

const openStatus = await graceChild.rpc('attempt_status', {
    p_attempt_id: graceAttempt.data.attempt_id,
});
check(
    'при отворен клас няма ограничение във времето',
    openStatus.data?.seconds_left === null,
    JSON.stringify(openStatus.data)
);

// Времето на часа изтича, докато детето още решава.
await expireLesson(klass.data.id);

// --- Тестът се решава в час, а не от вкъщи -----------------------------------
// Сесията на детето е жива (localStorage + анонимна сесия го надживяват часа),
// но часът е свършил. Точно това е сценарият „дете отваря приложението вечерта
// вкъщи“ — и точно тук трябва да не може нищо да започне.
const homeLesson = await graceChild.rpc('student_lesson_state', { p_student_id: otherStudent.id });
check(
    'извън час детето вижда, че часът е затворен',
    homeLesson.data?.open === false,
    JSON.stringify(homeLesson.data)
);

const homeList = await graceChild.rpc('student_quizzes', { p_student_id: otherStudent.id });
check(
    'извън час нито един тест не се води достъпен',
    homeList.data?.length > 0 && homeList.data.every((q) => q.can_start === false),
    JSON.stringify(homeList.data)
);

checkBlocked(
    'извън час детето не може да започне тест от вкъщи',
    await graceChild.rpc('start_attempt', {
        p_student_id: otherStudent.id,
        p_quiz_id: quiz.data.id,
    })
);

// Учителят вижда, че има кого да изчака, и получава въпроса за гратиса.
const lessonState = await teacher.rpc('class_lesson_state', { p_class_id: klass.data.id });
check('часът се води приключен', lessonState.data?.phase === 'expired', JSON.stringify(lessonState.data));
check('таблото брои децата, които още решават', lessonState.data?.still_playing >= 1);
check('на учителя се предлага гратис', lessonState.data?.can_grant_grace === true);

const granted = await teacher.rpc('grant_grace', { p_class_id: klass.data.id });
check('учителят разрешава 5 минути', !!granted.data?.grace_until, granted.error?.message);

const graceStatus = await graceChild.rpc('attempt_status', {
    p_attempt_id: graceAttempt.data.attempt_id,
});
check(
    `гратисът е около 5 минути (${graceStatus.data?.seconds_left} сек.)`,
    graceStatus.data?.seconds_left > 280 && graceStatus.data?.seconds_left <= 300,
    JSON.stringify(graceStatus.data)
);
check('детето е в гратисен период', graceStatus.data?.in_grace === true);

// В гратиса още може да отговаря.
const graceQ = graceAttempt.data.questions[0];
const graceSubmit = await graceChild.rpc('submit_answer', {
    p_attempt_id: graceAttempt.data.attempt_id,
    p_question_id: graceQ.id,
    p_answer_id: graceQ.answers[0].id,
    p_time_taken_ms: 2000,
});
check('в гратиса детето още отговаря', !graceSubmit.error, graceSubmit.error?.message);

checkBlocked(
    'втори гратис за същия час не се дава',
    await teacher.rpc('grant_grace', { p_class_id: klass.data.id })
);
checkBlocked(
    'чужд учител не може да дава гратис',
    await other.rpc('grant_grace', { p_class_id: klass.data.id })
);
checkBlocked(
    'нов час не може да започне, докато тече гратис',
    await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 })
);


// Нов тест обаче не може да започне — гратисът е за ДОВЪРШВАНЕ.
checkBlocked(
    'нов тест не се започва след затваряне',
    await graceChild.rpc('start_attempt', {
        p_student_id: otherStudent.id,
        p_quiz_id: quiz.data.id,
    })
);

// Подсказката пътува с въпроса, защото е за ПРЕДИ отговора.
const withHint = graceAttempt.data.questions.find((q) => q.hint);
check('подсказката стига до детето заедно с въпроса', !!withHint?.hint, 'няма въпрос с подсказка');

// Заглавният ред идва от учителя.
const headlineCheck = await graceChild.rpc('submit_answer', {
    p_attempt_id: graceAttempt.data.attempt_id,
    p_question_id: graceAttempt.data.questions[1].id,
    p_answer_id: null,
    p_time_taken_ms: 1000,
});
check(
    'submit_answer връща заглавен ред',
    typeof headlineCheck.data?.headline === 'string' && headlineCheck.data.headline.length > 0,
    JSON.stringify(headlineCheck.data)
);

// ...но след изтичането му — може. Отказът е временен, не окончателен.
await expireLesson(klass.data.id);
const afterGrace = await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });
check(
    'след изтичане на гратиса нов час се отваря',
    !!afterGrace.data?.joining_open_until,
    afterGrace.error?.message
);

// Новият час нулира гратиса — всеки час има право на свой.
const freshGraceState = await teacher.rpc('class_lesson_state', { p_class_id: klass.data.id });
check(
    'новият час започва с неизползван гратис',
    freshGraceState.data?.grace_used === false,
    JSON.stringify(freshGraceState.data)
);


// =============================================================================
console.log('\n\x1b[1m10. Един тест — един опит; упражненията са изключение\x1b[0m');
// =============================================================================

// Клиентът `child` държи „Ученик 3“ от секция 6, където опитът му беше
// приключен автоматично при изтичане на часа.
// Отварянето на нов час в секция 9 вече прибра теста в архива. Връщаме го,
// за да се провери правилото „един опит“, а не архивирането.
await teacher.from('quizzes').update({ archived_at: null }).eq('id', quiz.data.id);

const solvedList = await child.rpc('student_quizzes', { p_student_id: third.id });
const solved = solvedList.data?.find((q) => q.id === quiz.data.id);
check('решеният тест се показва като приключен', solved?.can_start === false, JSON.stringify(solved));

// Нов час, за да е позволено ново стартиране откъм прозореца. Веднага след
// това връщаме теста от архива — така следващата проверка доказва правилото
// „един опит“, а не просто че тестът е архивиран.
await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });
await teacher.from('quizzes').update({ archived_at: null }).eq('id', quiz.data.id);

checkBlocked(
    'решен тест не се отваря втори път',
    await child.rpc('start_attempt', { p_student_id: third.id, p_quiz_id: quiz.data.id })
);

// Същият тест, отбелязан като упражнение, вече може многократно.
const asPractice = await teacher
    .from('quizzes')
    .update({ is_practice: true, archived_at: null })
    .eq('id', quiz.data.id)
    .select('is_practice')
    .single();
check('тестът се отбелязва като упражнение', asPractice.data?.is_practice === true, asPractice.error?.message);

const practiceRun = await child.rpc('start_attempt', {
    p_student_id: third.id,
    p_quiz_id: quiz.data.id,
});
check('упражнението се решава повторно', !!practiceRun.data?.attempt_id, practiceRun.error?.message);
await child.rpc('finish_attempt', { p_attempt_id: practiceRun.data.attempt_id });

// =============================================================================
console.log('\n\x1b[1m11. Нов час прибира решените тестове в архива\x1b[0m');
// =============================================================================

// Връщаме теста към обикновен, за да може да се архивира.
await teacher.from('quizzes').update({ is_practice: false }).eq('id', quiz.data.id);
await expireLesson(klass.data.id);

/*
 * Упражнението се създава СЕГА, докато часът е затворен.
 * По време на час тестовете са заключени за редакция — добавянето на въпрос
 * би било отказано от тригера. Това е същото ограничение, което учителят
 * усеща в интерфейса.
 */
const practiceQuiz = await teacher
    .from('quizzes')
    .insert({
        teacher_id: teacherId,
        class_id: klass.data.id,
        title: 'Таблица за 2 — упражнение',
        subject: 'Математика',
        grade: 2,
        is_practice: true,
    })
    .select('id')
    .single();
const pq = await teacher
    .from('questions')
    .insert({ quiz_id: practiceQuiz.data.id, prompt: '2 × 2 = ?', position: 0 })
    .select('id')
    .single();
check('упражнението се създава при затворен час', !!pq.data?.id, pq.error?.message);
await teacher.from('answers').insert([
    { question_id: pq.data.id, text: '4', is_correct: true, position: 0 },
    { question_id: pq.data.id, text: '5', is_correct: false, position: 1 },
]);
await teacher.rpc('publish_quiz', { p_quiz_id: practiceQuiz.data.id, p_publish: true });

const reopened = await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });
check('нов час се отваря след изтичане на стария', !!reopened.data, reopened.error?.message);

// „Ученик 2“ още не е решил теста — значи НЕ бива да се архивира.
// Това е сценарият с болното дете, което се връща след седмица.
const notYetArchived = await teacher
    .from('quizzes')
    .select('archived_at')
    .eq('id', quiz.data.id)
    .single();
check(
    'тест с непредали ученици НЕ отива в архива',
    notYetArchived.data?.archived_at === null,
    JSON.stringify(notYetArchived.data)
);

const pending = await teacher.rpc('quiz_progress', { p_quiz_id: quiz.data.id });
check(
    'учителят вижда кого чака',
    pending.data?.pending === 1 && pending.data?.pending_names?.includes('Ученик 2'),
    JSON.stringify(pending.data)
);

// Тестът остава достъпен точно за него, а не за вече решилите.
const lateList = await graceChild.rpc('student_quizzes', { p_student_id: otherStudent.id });
check(
    'закъснялото дете още вижда теста',
    lateList.data?.find((q) => q.id === quiz.data.id)?.can_start === true,
    JSON.stringify(lateList.data)
);

// Той го решава — и чак сега тестът е готов за архива.
const lateAttempt = await graceChild.rpc('start_attempt', {
    p_student_id: otherStudent.id,
    p_quiz_id: quiz.data.id,
});
check('закъснялото дете решава теста', !!lateAttempt.data?.attempt_id, lateAttempt.error?.message);
await graceChild.rpc('finish_attempt', { p_attempt_id: lateAttempt.data.attempt_id });

await expireLesson(klass.data.id);
await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

const archivedQuiz = await teacher
    .from('quizzes')
    .select('archived_at, is_practice')
    .eq('id', quiz.data.id)
    .single();
check(
    'след като ВСИЧКИ решат, тестът отива в архива',
    archivedQuiz.data?.archived_at !== null,
    JSON.stringify(archivedQuiz.data)
);

const afterArchive = await child.rpc('student_quizzes', { p_student_id: target.id });
check(
    'архивираният тест изчезва от списъка на детето',
    !afterArchive.data?.some((q) => q.id === quiz.data.id),
    JSON.stringify(afterArchive.data)
);

// =============================================================================
console.log('\n\x1b[1m11б. Архивът прескача отсъстващите\x1b[0m');
// =============================================================================
// Дълго отсъстващо дете не бива да задържа решения тест в списъка на класа —
// но и не бива да го губи. Проверяваме двете наведнъж.
//
// В този момент клиентът `child` държи „Ученик 3“ (third), а `graceChild` —
// „Ученик 2“ (otherStudent). „Ученик 1“ няма активна сесия и затова се
// отбелязва като отсъстващ заедно с „Ученик 2“.

// Тестът се създава при ЗАТВОРЕН час — редакцията е заключена, докато тече час.
await expireLesson(klass.data.id);

const solo = await teacher
    .from('quizzes')
    .insert({
        teacher_id: teacherId,
        class_id: klass.data.id,
        title: 'Тест за отсъстващо дете',
        subject: 'Математика',
        grade: 2,
    })
    .select('id')
    .single();
check('създаден е тест за проверката', !!solo.data?.id, solo.error?.message);

const soloQ = await teacher
    .from('questions')
    .insert({ quiz_id: solo.data.id, prompt: '1 + 1 = ?', position: 0 })
    .select('id')
    .single();
check('добавен е въпрос', !!soloQ.data?.id, soloQ.error?.message);

await teacher.from('answers').insert([
    { question_id: soloQ.data.id, text: '2', is_correct: true, position: 0 },
    { question_id: soloQ.data.id, text: '3', is_correct: false, position: 1 },
]);
const soloPub = await teacher.rpc('publish_quiz', { p_quiz_id: solo.data.id, p_publish: true });
check('тестът е публикуван', !!soloPub.data, soloPub.error?.message);

// Двете деца без активна сесия отсъстват; решава само „Ученик 3“.
await teacher.rpc('set_absent', { p_student_id: target.id, p_absent: true });
await teacher.rpc('set_absent', { p_student_id: otherStudent.id, p_absent: true });

await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

const soloAttempt = await child.rpc('start_attempt', {
    p_student_id: third.id,
    p_quiz_id: solo.data.id,
});
check('присъстващото дете решава теста', !!soloAttempt.data?.attempt_id, soloAttempt.error?.message);
await child.rpc('finish_attempt', { p_attempt_id: soloAttempt.data.attempt_id });

await expireLesson(klass.data.id);
await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

const soloState = await teacher
    .from('quizzes')
    .select('archived_at, auto_archived')
    .eq('id', solo.data.id)
    .single();
check(
    'тестът се архивира, без да чака отсъстващите',
    soloState.data?.archived_at !== null && soloState.data?.auto_archived === true,
    JSON.stringify(soloState.data)
);

const solvedView = await child.rpc('student_quizzes', { p_student_id: third.id });
check(
    'за решилото го дете тестът изчезва от списъка',
    !solvedView.data?.some((q) => q.id === solo.data.id),
    JSON.stringify(solvedView.data)
);

// Детето се връща и намира теста си на мястото му.
await teacher.rpc('set_absent', { p_student_id: otherStudent.id, p_absent: false });
const backView = await graceChild.rpc('student_quizzes', { p_student_id: otherStudent.id });
check(
    'върналото се дете още вижда архивирания тест',
    backView.data?.find((q) => q.id === solo.data.id)?.can_start === true,
    JSON.stringify(backView.data)
);

const lateSolve = await graceChild.rpc('start_attempt', {
    p_student_id: otherStudent.id,
    p_quiz_id: solo.data.id,
});
check('и го решава след архивирането', !!lateSolve.data?.attempt_id, lateSolve.error?.message);
if (lateSolve.data?.attempt_id) {
    await graceChild.rpc('finish_attempt', { p_attempt_id: lateSolve.data.attempt_id });
}

const doneView = await graceChild.rpc('student_quizzes', { p_student_id: otherStudent.id });
check(
    'след като го реши, тестът изчезва и от неговия списък',
    !doneView.data?.some((q) => q.id === solo.data.id),
    JSON.stringify(doneView.data)
);

// Ръчният архив остава ТВЪРД: скрива теста дори от онзи, който не го е решил.
// Затова се проверява с НОВ тест, който никой не е решавал.
await expireLesson(klass.data.id);

const withdrawn = await teacher
    .from('quizzes')
    .insert({
        teacher_id: teacherId,
        class_id: klass.data.id,
        title: 'Сгрешен тест за изтегляне',
        subject: 'Математика',
        grade: 2,
    })
    .select('id')
    .single();
const withdrawnQ = await teacher
    .from('questions')
    .insert({ quiz_id: withdrawn.data.id, prompt: '2 + 2 = ?', position: 0 })
    .select('id')
    .single();
await teacher.from('answers').insert([
    { question_id: withdrawnQ.data.id, text: '4', is_correct: true, position: 0 },
    { question_id: withdrawnQ.data.id, text: '5', is_correct: false, position: 1 },
]);
await teacher.rpc('publish_quiz', { p_quiz_id: withdrawn.data.id, p_publish: true });

const manual = await teacher
    .from('quizzes')
    .update({ archived_at: new Date().toISOString(), auto_archived: false })
    .eq('id', withdrawn.data.id)
    .select('id')
    .single();
check('учителят изтегля тест ръчно', !!manual.data?.id, manual.error?.message);

await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });
await teacher.rpc('set_absent', { p_student_id: target.id, p_absent: false });

const manualView = await child.rpc('student_quizzes', { p_student_id: third.id });
check(
    'ръчно изтеглен тест е скрит и за нерешилите',
    !manualView.data?.some((q) => q.id === withdrawn.data.id),
    JSON.stringify(manualView.data)
);

checkBlocked(
    'ръчно изтеглен тест не се стартира',
    await child.rpc('start_attempt', { p_student_id: third.id, p_quiz_id: withdrawn.data.id })
);

checkBlocked(
    'архивиран тест не се стартира',
    await child.rpc('start_attempt', { p_student_id: target.id, p_quiz_id: quiz.data.id })
);

// Упражнение НЕ се архивира при нов час — детето го решава и проверяваме.
const practiceAttempt = await child.rpc('start_attempt', {
    p_student_id: third.id,
    p_quiz_id: practiceQuiz.data.id,
});
await child.rpc('finish_attempt', { p_attempt_id: practiceAttempt.data.attempt_id });

await expireLesson(klass.data.id);
await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

const practiceAfter = await teacher
    .from('quizzes')
    .select('archived_at')
    .eq('id', practiceQuiz.data.id)
    .single();
check(
    'упражнението НЕ се архивира при нов час',
    practiceAfter.data?.archived_at === null,
    JSON.stringify(practiceAfter.data)
);
// =============================================================================
console.log('\n\x1b[1m12. Банка с въпроси\x1b[0m');
// =============================================================================
await expireLesson(klass.data.id);

const bank = await teacher
    .from('quizzes')
    .insert({
        teacher_id: teacherId,
        class_id: klass.data.id,
        title: 'Таблица за 5 — банка',
        subject: 'Математика',
        grade: 2,
        is_practice: true,
        questions_per_attempt: 2,
    })
    .select('id')
    .single();

for (let i = 1; i <= 6; i++) {
    const q = await teacher
        .from('questions')
        .insert({ quiz_id: bank.data.id, prompt: `5 × ${i} = ?`, position: i - 1 })
        .select('id')
        .single();
    await teacher.from('answers').insert([
        { question_id: q.data.id, text: String(5 * i), is_correct: true, position: 0 },
        { question_id: q.data.id, text: String(5 * i + 1), is_correct: false, position: 1 },
    ]);
}

const bankPublish = await teacher.rpc('publish_quiz', { p_quiz_id: bank.data.id, p_publish: true });
check('банката се публикува', bankPublish.data?.is_published === true, bankPublish.error?.message);

checkBlocked(
    'не може да се искат повече въпроси, отколкото има',
    await teacher
        .from('quizzes')
        .update({ questions_per_attempt: 99 })
        .eq('id', bank.data.id)
        .select('id')
        .single()
        .then((r) => (r.error ? r : teacher.rpc('publish_quiz', { p_quiz_id: bank.data.id })))
);
await teacher.from('quizzes').update({ questions_per_attempt: 2 }).eq('id', bank.data.id);

await teacher.rpc('open_class', { p_class_id: klass.data.id, p_minutes: 45 });

const bankRun = await child.rpc('start_attempt', {
    p_student_id: third.id,
    p_quiz_id: bank.data.id,
});
check(
    `детето получава 2 от 6 въпроса (получени ${bankRun.data?.questions?.length})`,
    bankRun.data?.questions?.length === 2,
    bankRun.error?.message
);
check(
    'точките отговарят на изтеглените въпроси',
    bankRun.data?.max_score === 2,
    JSON.stringify(bankRun.data?.max_score)
);

// Въпрос извън изтеглените не се приема — иначе банката би се заобиколила.
const allBankQ = await teacher.from('questions').select('id').eq('quiz_id', bank.data.id);
const drawn = new Set(bankRun.data.questions.map((q) => q.id));
const notDrawn = allBankQ.data.find((q) => !drawn.has(q.id));
checkBlocked(
    'въпрос извън изтеглените се отхвърля',
    await child.rpc('submit_answer', {
        p_attempt_id: bankRun.data.attempt_id,
        p_question_id: notDrawn.id,
        p_answer_id: null,
        p_time_taken_ms: 500,
    })
);

// Второ теглене дава (почти сигурно) друг набор.
const secondDraw = await child.rpc('start_attempt', {
    p_student_id: third.id,
    p_quiz_id: bank.data.id,
});
const drawsDiffer =
    JSON.stringify(bankRun.data.questions.map((q) => q.id).sort()) !==
    JSON.stringify(secondDraw.data.questions.map((q) => q.id).sort());
check(
    'второ теглене дава друг набор въпроси',
    drawsDiffer,
    'възможно е и съвпадение — 1 от 15 при 2 от 6'
);

// =============================================================================
console.log('\n\x1b[1m13. Протокол на предаден тест\x1b[0m');
// =============================================================================
const bankQ = bankRun.data.questions[0];
await child.rpc('submit_answer', {
    p_attempt_id: bankRun.data.attempt_id,
    p_question_id: bankQ.id,
    p_answer_id: bankQ.answers[0].id,
    p_time_taken_ms: 3000,
});
await child.rpc('finish_attempt', { p_attempt_id: bankRun.data.attempt_id });

const report = await teacher.rpc('attempt_report', { p_attempt_id: bankRun.data.attempt_id });
check('протоколът се зарежда', !!report.data, report.error?.message);
check('съдържа псевдонима, не име', report.data?.student?.display_name === 'Ученик 3');
check('съдържа заглавието на теста', report.data?.quiz?.title === 'Таблица за 5 — банка');
check('съдържа само изтеглените въпроси', report.data?.questions?.length === 2);
check(
    'отбелязва неотговорения въпрос',
    report.data?.questions?.some((q) => q.answered === false),
    JSON.stringify(report.data?.questions)
);
check(
    'показва верния отговор',
    report.data?.questions?.every((q) => typeof q.correct_answer === 'string'),
    JSON.stringify(report.data?.questions)
);

checkBlocked(
    'чужд учител не вижда протокола',
    await other.rpc('attempt_report', { p_attempt_id: bankRun.data.attempt_id })
);

// =============================================================================
console.log(`\n\x1b[1mРезултат: ${passed} успешни, ${failed} неуспешни\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
