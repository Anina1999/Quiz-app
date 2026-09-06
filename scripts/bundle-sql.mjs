/**
 * Слепва всички миграции в един файл, който може да се постави наведнъж в
 * Supabase SQL Editor. Полезно е, докато проектът не е свързан с CLI —
 * иначе се ползва `npm run db:push`.
 *
 *   npm run db:bundle   ->   supabase/dist/full-schema.sql
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'supabase/migrations';
const OUT_DIR = 'supabase/dist';
const OUT = join(OUT_DIR, 'full-schema.sql');

const files = readdirSync(SRC)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const header = [
    '-- ==========================================================================',
    '-- QUIZ APP — цялата схема в един файл, за поставяне в Supabase SQL Editor.',
    '-- Генериран автоматично от supabase/migrations/. Не го редактирай ръчно —',
    '-- промените се правят в миграциите, после пусни: npm run db:bundle',
    '-- ==========================================================================',
    '',
];

const body = files.flatMap((f) => ['', `-- ▼▼▼ ${f} ▼▼▼`, '', readFileSync(join(SRC, f), 'utf8')]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, [...header, ...body].join('\n'), 'utf8');

console.log(`${OUT} — ${files.length} миграции, ${[...header, ...body].join('\n').split('\n').length} реда`);
