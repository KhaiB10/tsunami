// surge.js — LLM-aware load and overflow testing for a chat endpoint.
//
// Two things generic HTTP load tools miss about AI endpoints:
//   1. OVERFLOW SAFETY. When a prompt is bigger than the model's context, a safe
//      endpoint errors. A dangerous one silently truncates — drops the middle,
//      tools included — and answers anyway, so the caller trusts a reply built on
//      half the prompt. We detect it directly: plant an instruction at the very
//      START of an oversized prompt; if the reply ignores it, the start was cut.
//   2. CONCURRENCY on a single model. A local GPU serves one request at a time,
//      so concurrency turns into a queue; latency percentiles and the error rate
//      under load are what tell you your real capacity.
//
// Everything here is pure enough to test with an injected `send`, so the metrics
// and the overflow judgement are verifiable without hammering a real endpoint.

/** Percentile from a sorted-or-unsorted number array (nearest-rank). */
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, i)];
}

const CANARY = 'BANANA7';
const OVERFLOW_PROMPT = (approxTokens) =>
  // instruction first (truncation keeps the tail, so a dropped START = truncation)
  `Very important: begin your reply with the single word ${CANARY} in capitals, then answer.\n\n`
  + ('The quick brown fox jumps over the lazy dog. '.repeat(Math.ceil(approxTokens * 4 / 44)))
  + '\n\nNow, what is 2+2?';

const defaultSend = async (url, body, { apiKey, timeoutMs }) => {
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let content = '';
  try { content = JSON.parse(text).choices?.[0]?.message?.content || ''; } catch { /* non-json */ }
  return { status: r.status, ok: r.ok, content, raw: text };
};

/**
 * Overflow-safety probe: send a prompt of ~promptTokens with a canary at the
 * start. Returns 'errored' (safe — rejected the oversized prompt),
 * 'truncated' (dangerous — answered but dropped the start), or 'ok' (handled it,
 * canary survived).
 */
export async function overflowProbe({ url, model, promptTokens = 32000, apiKey, timeoutMs = 120000, send = defaultSend }) {
  const body = { model, messages: [{ role: 'user', content: OVERFLOW_PROMPT(promptTokens) }], max_tokens: 30, temperature: 0 };
  let res;
  try { res = await send(url, body, { apiKey, timeoutMs }); }
  catch (e) { return { verdict: 'errored', detail: `request failed: ${e.message}`, safe: true }; }
  if (!res.ok) return { verdict: 'errored', detail: `HTTP ${res.status} (rejected the oversized prompt — safe)`, safe: true };
  const kept = res.content.toUpperCase().includes(CANARY);
  return kept
    ? { verdict: 'ok', detail: 'handled the large prompt and kept the start', safe: true }
    : { verdict: 'truncated', detail: 'answered but dropped the start of the prompt — silent truncation', safe: false };
}

/** Fire `total` requests, `concurrency` at a time; collect latency + errors. */
export async function flood({ url, model, concurrency = 8, total = 40, prompt = 'Reply with only the word OK.', apiKey, timeoutMs = 60000, send = defaultSend, onProgress = () => {} }) {
  const body = () => ({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 5, temperature: 0 });
  const latencies = []; let ok = 0, errors = 0, done = 0;
  const t0 = Date.now();
  let next = 0;
  async function worker() {
    while (next < total) {
      const _ = next++;
      const s = Date.now();
      try { const r = await send(url, body(), { apiKey, timeoutMs }); if (r.ok) { ok++; latencies.push(Date.now() - s); } else errors++; }
      catch { errors++; }
      onProgress(++done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const wall = (Date.now() - t0) / 1000;
  return {
    concurrency, total, ok, errors,
    error_rate: total ? errors / total : 0,
    throughput_rps: wall > 0 ? +(ok / wall).toFixed(2) : null,
    p50_ms: percentile(latencies, 50), p95_ms: percentile(latencies, 95), p99_ms: percentile(latencies, 99),
    wall_s: +wall.toFixed(1),
  };
}

/** Ramp concurrency until the error rate crosses `maxErrorRate` — the capacity knee. */
export async function ramp({ url, model, steps = [1, 2, 4, 8, 16, 32], perStep = 16, maxErrorRate = 0.1, apiKey, send = defaultSend, onStep = () => {} }) {
  const results = [];
  let capacity = null;
  for (const c of steps) {
    const r = await flood({ url, model, concurrency: c, total: Math.max(perStep, c), apiKey, send });
    results.push(r); onStep(r);
    if (r.error_rate <= maxErrorRate) capacity = c; else break;
  }
  return { capacity, maxErrorRate, steps: results };
}
