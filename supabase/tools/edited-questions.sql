-- =============================================================================
--  Кога е редактиран всеки въпрос
--
--  Пусни в Supabase SQL Editor. Показва по един ред на въпрос, подредени с
--  най-скоро редактираните най-отгоре.
--
--  ЗАБЕЛЕЖКА: базата пази само МОМЕНТА НА ПОСЛЕДНАТА промяна, не история на
--  промените. Не се вижда какво е било преди, нито колко пъти е пипано.
--  За пълна история трябва отделна таблица (виж бележката най-долу).
-- =============================================================================

select q.title                                   as "Тест",
       qn.position + 1                           as "№",
       left(qn.prompt, 45)                       as "Въпрос",

       to_char(qn.created_at at time zone 'Europe/Sofia', 'DD.MM.YYYY HH24:MI:SS')
                                                 as "Създаден",

       -- Сравнението е ТОЧНО, без допуск: при вмъкване двете стойности идват от
       -- едно и също now(), а updated_at се променя само от тригера при UPDATE.
       -- Всяка разлика, дори под секунда, значи че въпросът е бил редактиран.
       case when qn.updated_at > qn.created_at
            then to_char(qn.updated_at at time zone 'Europe/Sofia', 'DD.MM.YYYY HH24:MI:SS')
            else '—'
       end                                       as "Редактиран",

       -- Отговорите имат собствен updated_at. Ако той е по-нов от този на
       -- въпроса, значи последно е пипан някой отговор, а не самият текст.
       case when max(a.updated_at) > max(a.created_at)
            then to_char(max(a.updated_at) at time zone 'Europe/Sofia', 'DD.MM.YYYY HH24:MI:SS')
            else '—'
       end                                       as "Отговор редактиран",

       case when qn.explanation_correct is not null
             and qn.explanation_wrong is not null then 'и двете'
            when qn.explanation_correct is not null then 'само при верен'
            when qn.explanation_wrong is not null   then 'само при грешен'
            else 'няма'
       end                                       as "Обяснения"

from public.questions qn
join public.quizzes q on q.id = qn.quiz_id
left join public.answers a on a.question_id = qn.id
group by q.title, qn.id, qn.position, qn.prompt, qn.created_at, qn.updated_at,
         qn.explanation_correct, qn.explanation_wrong
order by greatest(qn.updated_at, coalesce(max(a.updated_at), qn.updated_at)) desc;

-- =============================================================================
--  Ако ти трябва пълна история (кой какво е сменил и на какво), това е отделна
--  функционалност: таблица question_revisions + тригер, който при всяка промяна
--  записва старата стойност. Кажи, ако я искаш.
-- =============================================================================
