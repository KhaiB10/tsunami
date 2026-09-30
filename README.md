# tsunami 🌊

**Surge an AI endpoint until it breaks — and catch the break that generic load tools miss.** Tsunami floods your chat endpoint with concurrency *and* checks whether an oversized prompt errors cleanly or gets **silently truncated** (answered on half the prompt, with no warning).

```bash
tsunami --model qwen3:8b storm
```

```
🔴 overflow: TRUNCATED — answered but dropped the start of the prompt — silent truncation
   ⚠ the endpoint answered on a prompt whose start it silently dropped. Raise the context, or put ollama-guard in front.

🌊 flood @ 4: 12/12 ok, 0% errors, 5.3 req/s
   latency  p50 546ms   p95 1174ms   p99 1174ms
```

## The two things it checks

**Overflow safety** — the one nobody load-tests. When a prompt is bigger than the model's context, a safe endpoint returns an error. A dangerous one silently truncates: drops the middle of the prompt, tools and all, and answers anyway — so your caller trusts a reply built on half the input. Tsunami plants an instruction at the very **start** of an oversized prompt; if the reply ignores it, the start was cut, and the endpoint is unsafe. (That's [ollama-guard](https://github.com/KhaiB10/ollama-guard)'s whole reason to exist.)

**Load under concurrency** — a local model serves one request at a time, so concurrency becomes a queue. Tsunami reports the numbers that matter: latency p50/p95/p99, error rate, throughput, and the **capacity knee** — the highest concurrency your endpoint holds before errors climb.

## Use it

```bash
npm install -g @khaib10/tsunami

tsunami --model qwen3:8b overflow --tokens 32000       # is an oversized prompt handled or silently truncated?
tsunami --model qwen3:8b flood --concurrency 16 --total 200   # latency + error rate under load
tsunami --model qwen3:8b ramp --steps 1,2,4,8,16,32    # find the capacity knee
tsunami --model gpt-4o-mini --base-url https://api.openai.com/v1 storm   # all three
```

`OPENAI_API_KEY` is read from the environment for remote endpoints. The process exits nonzero if the endpoint truncates silently, errors under load, or has no stable capacity — so `tsunami` works as a CI gate too.

## Only surge what you own

Tsunami sends real load to whatever endpoint you point it at. Use it on **your own endpoint, or one you're authorized to load-test** — flooding someone else's service is an attack, not a test. Start with a low `--concurrency` and raise it.

The surge in a suite of AI-agent resilience tools: 🌪 [tornado](https://github.com/KhaiB10/tornado) (inject model failures), 🦈 [shark](https://github.com/KhaiB10/shark) (detect leaks), 🐍 [viper](https://github.com/KhaiB10/viper) (injection strikes), 🌀 [hurricane](https://github.com/KhaiB10/hurricane) (one graded scorecard), 🌊 tsunami (surge). See the [Agent Resilience Kit](https://github.com/KhaiB10/agent-resilience-kit).

## Test

```bash
npm test
```

## License

MIT
