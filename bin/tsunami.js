#!/usr/bin/env node
import { overflowProbe, flood, ramp } from '../src/surge.js';

const HELP = `tsunami 🌊 — surge an AI endpoint: overflow safety + load under concurrency.

  tsunami --model NAME [--base-url http://127.0.0.1:11434/v1] <command>

Commands:
  overflow            send an oversized prompt with a canary at the start; does the
                      endpoint error (safe) or silently truncate (dangerous)?
    --tokens 32000    approximate prompt size
  flood               fire requests under concurrency; report latency + error rate
    --concurrency 8   --total 40
  ramp                raise concurrency until errors climb; find the capacity knee
    --steps 1,2,4,8,16,32   --max-error-rate 0.1
  storm               overflow + a flood + a ramp, one report (default)

Only surge endpoints you own or are authorized to load-test.`;

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) o[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    else o._.push(a);
  }
  return o;
}
const ms = (v) => v == null ? '  —  ' : `${v}ms`;
const ICON = { ok: '🟢', truncated: '🔴', errored: '🟢' };

const o = args(process.argv.slice(2));
if (o.help || !o.model) { console.log(HELP); process.exit(o.help ? 0 : 2); }
const url = `${(o['base-url'] || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/$/, '')}/chat/completions`;
const apiKey = process.env.OPENAI_API_KEY;
const cmd = o._[0] || 'storm';
let bad = false;

async function doOverflow() {
  process.stderr.write('overflow probe… ');
  const r = await overflowProbe({ url, model: o.model, promptTokens: Number(o.tokens || 32000), apiKey });
  process.stderr.write('\n');
  console.log(`${ICON[r.verdict]} overflow: ${r.verdict.toUpperCase()} — ${r.detail}`);
  if (!r.safe) { bad = true; console.log('   ⚠ the endpoint answered on a prompt whose start it silently dropped. Raise the context, or put ollama-guard in front.'); }
}
async function doFlood() {
  const c = Number(o.concurrency || 8), total = Number(o.total || 40);
  process.stderr.write(`flood: ${total} requests @ concurrency ${c}… `);
  const r = await flood({ url, model: o.model, concurrency: c, total, apiKey, onProgress: (d, t) => process.stderr.write(`\rflood: ${d}/${t}   `) });
  process.stderr.write('\n');
  console.log(`🌊 flood @ ${r.concurrency}: ${r.ok}/${r.total} ok, ${(r.error_rate * 100).toFixed(0)}% errors, ${r.throughput_rps ?? '—'} req/s`);
  console.log(`   latency  p50 ${ms(r.p50_ms)}   p95 ${ms(r.p95_ms)}   p99 ${ms(r.p99_ms)}`);
  if (r.error_rate > 0.1) bad = true;
}
async function doRamp() {
  const steps = (typeof o.steps === 'string' ? o.steps.split(',').map(Number) : [1, 2, 4, 8, 16, 32]);
  process.stderr.write('ramp… ');
  const r = await ramp({ url, model: o.model, steps, maxErrorRate: Number(o['max-error-rate'] || 0.1), apiKey,
    onStep: (s) => process.stderr.write(`\rramp: @${s.concurrency} ${(s.error_rate * 100).toFixed(0)}% err   `) });
  process.stderr.write('\n');
  for (const s of r.steps) console.log(`   @${String(s.concurrency).padStart(3)}  ${(s.error_rate * 100).toFixed(0).padStart(3)}% err   p95 ${ms(s.p95_ms)}   ${s.throughput_rps ?? '—'} req/s`);
  console.log(`🌊 capacity: stable up to concurrency ${r.capacity ?? '<1'} (≤${Math.round(r.maxErrorRate * 100)}% errors)`);
  if (r.capacity == null) bad = true;
}

console.log(`\ntsunami 🌊 — ${o.model} @ ${url}\n`);
if (cmd === 'overflow') await doOverflow();
else if (cmd === 'flood') await doFlood();
else if (cmd === 'ramp') await doRamp();
else if (cmd === 'storm') { await doOverflow(); console.log(''); await doFlood(); console.log(''); await doRamp(); }
else { console.log(`unknown command '${cmd}'`); process.exit(2); }
process.exitCode = bad ? 1 : 0;
