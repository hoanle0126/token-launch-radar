import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const model = require('./dashboard/model.js') as {
  buildRadar: (snapshot: unknown) => { board: Array<{ rank: number; slug: string; implied_value_usd: number; farm_steps: string[] }>; radar: { universe_counts: Record<string, number> } };
};

function boardIssue(board: Array<{ rank: number; slug: string; implied_value_usd: number; farm_steps: string[] }>, snapshot: { watchlist: string[] }): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const miss = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (miss.length) return `missing watchlist: ${miss.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `bad count ${board.length}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `bad rank ${i}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `non-monotonic ${i}`;
    if (!r.farm_steps || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `bad steps ${r.slug}`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `bad step len ${r.slug}`;
  }
  return null;
}

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: missing snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const prepareOnly = process.argv.includes('--prepare');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
const { board, radar } = model.buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launch radar: board gate issue: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);
const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));

if (!prepareOnly) {
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`launch radar: need at least 3 screenshots, found ${shots.length}\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`launch radar: invalid screenshot name ${name}\n`);
      process.exit(1);
    }
  }
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: SCREENSHOT_CAPS,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );
}

const u = radar.universe_counts;
process.stdout.write(
  `launch radar: ${u.total} protocols (${u.watchlist} watchlist + ${u.early_pre_token} early = ${board.length} board rows), ${dashFiles.length} dashboard files\n`,
);
