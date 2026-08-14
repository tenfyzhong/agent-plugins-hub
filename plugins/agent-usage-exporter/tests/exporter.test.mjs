import assert from "node:assert/strict";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  buildMetricsPayload,
  costForUsagePoint,
  parseClaudeCodeTranscript,
  parseCodexTranscript,
  parsePiTranscript,
  resolvePricing,
  resolveProjectName,
  withStateLock,
} from "../lib/exporter.mjs";
import { processUsageExport } from "../hooks/worker.mjs";
import { isExpectedHost } from "../hooks/host-launcher.mjs";

test("Codex transcript parser tracks model changes and leaves partial lines pending", () => {
  const source = [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10, output_tokens: 4 } } } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5-mini" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 3, cached_input_tokens: 2, output_tokens: 1 } } } }),
    '{"model":"gpt-5","usage":',
  ].join("\n");

  const parsed = parseCodexTranscript(source);

  assert.deepEqual(parsed.usage, [
    { model: "gpt-5", tokenType: "input", tokens: 10 },
    { model: "gpt-5", tokenType: "output", tokens: 4 },
    { model: "gpt-5-mini", tokenType: "input", tokens: 3 },
    { model: "gpt-5-mini", tokenType: "cached_input", tokens: 2 },
    { model: "gpt-5-mini", tokenType: "output", tokens: 1 },
  ]);
  assert.equal(parsed.pending, '{"model":"gpt-5","usage":');
});

test("native parsers accept only documented assistant usage schemas", async () => {
  const fixtures = join("plugins", "agent-usage-exporter", "tests", "fixtures");
  const claude = parseClaudeCodeTranscript(await readFile(join(fixtures, "claude-code-session.jsonl"), "utf8"));
  const pi = parsePiTranscript(await readFile(join(fixtures, "pi-session.jsonl"), "utf8"));
  const omp = parsePiTranscript(await readFile(join(fixtures, "oh-my-pi-session.jsonl"), "utf8"));

  assert.deepEqual(claude.usage, [
    { model: "claude-opus-5", tokenType: "input", tokens: 2 },
    { model: "claude-opus-5", tokenType: "cache_write", tokens: 36623 },
    { model: "claude-opus-5", tokenType: "output", tokens: 13 },
  ]);
  assert.deepEqual(pi.usage, [
    { model: "deepseek-v4-pro", tokenType: "input", tokens: 2331 },
    { model: "deepseek-v4-pro", tokenType: "cached_input", tokens: 3712 },
    { model: "deepseek-v4-pro", tokenType: "output", tokens: 156 },
  ]);
  assert.deepEqual(omp.usage, [
    { model: "deepseek-v4-flash", tokenType: "input", tokens: 168 },
    { model: "deepseek-v4-flash", tokenType: "cached_input", tokens: 36096 },
    { model: "deepseek-v4-flash", tokenType: "output", tokens: 23 },
  ]);
  assert.equal(parseClaudeCodeTranscript('{"type":"assistant","message":{"usage":{"output_tokens":99}}}').usage.length, 0);
});

test("Pi uses provider and modelId when an assistant record omits its model", () => {
  const parsed = parsePiTranscript([
    JSON.stringify({ type: "model_change", provider: "deepseek", modelId: "deepseek-v4-pro" }),
    JSON.stringify({ type: "message", message: { role: "assistant", usage: { output: 1 } } }),
  ].join("\n"));
  assert.deepEqual(parsed.usage, [{ model: "deepseek/deepseek-v4-pro", tokenType: "output", tokens: 1 }]);
});

test("native parsers retain partial records and resume model context", () => {
  const partial = '{"type":"message","message":{"role":"assistant"';
  const first = parsePiTranscript(`${JSON.stringify({ type: "model_change", model: "model-a" })}\n${partial}`);
  const second = parsePiTranscript(`${first.pending},"usage":{"output":7}}}`, first.model);
  assert.equal(first.pending, partial);
  assert.deepEqual(second.usage, [{ model: "model-a", tokenType: "output", tokens: 7 }]);
  const claudePartial = '{"type":"assistant","message":{"model":"claude","usage":';
  const claudeFirst = parseClaudeCodeTranscript(claudePartial);
  assert.equal(claudeFirst.pending, claudePartial);
  assert.deepEqual(
    parseClaudeCodeTranscript(`${claudeFirst.pending}{"output_tokens":7}}}`).usage,
    [{ model: "claude", tokenType: "output", tokens: 7 }],
  );
});

test("pricing preserves raw model labels and resolves explicit aliases", async () => {
  const pricing = JSON.parse(await readFile(join("plugins", "agent-usage-exporter", "pricing.json"), "utf8"));
  const raw = "openrouter/deepseek/deepseek-v4-flash";
  const offPeak = new Date(2026, 7, 14, 20, 0);
  assert.equal(costForUsagePoint({ model: raw, tokenType: "input", tokens: 1000000 }, pricing, offPeak), 0.2226);
  assert.equal(costForUsagePoint({ model: "deepseek-v4-pro", tokenType: "cached_input", tokens: 1000000 }, pricing, offPeak), 0.0223);
  assert.equal(costForUsagePoint({ model: "deepseek/deepseek-v4-flash", tokenType: "input", tokens: 1000000 }, pricing, offPeak), 0.2226);
  assert.equal(costForUsagePoint({ model: "deepseek/deepseek-v4-pro", tokenType: "input", tokens: 1000000 }, pricing, offPeak), 0.6677);
  assert.equal(costForUsagePoint({ model: "deepseek-v4-flash", tokenType: "cache_write", tokens: 1 }, pricing, offPeak), undefined);
  const directPrice = resolvePricing(pricing, { [raw]: { input: 0.5 } });
  assert.equal(costForUsagePoint({ model: raw, tokenType: "input", tokens: 1000000 }, directPrice), 0.5);
  const metrics = buildMetricsPayload("pi", [{ model: raw, tokenType: "input", tokens: 1000000 }], pricing);
  assert.equal(metrics.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].attributes[1].value.stringValue, raw);
});

test("Claude parser retains the latest cumulative snapshot for a repeated response ID", () => {
  const first = parseClaudeCodeTranscript(JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      model: "claude-sonnet-4",
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  }));
  const second = parseClaudeCodeTranscript(JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_123",
      model: "claude-sonnet-4",
      usage: { input_tokens: 10, cache_creation_input_tokens: 3, output_tokens: 2 },
    },
  }), first.model, first.responses);

  assert.deepEqual(first.usage, [
    { model: "claude-sonnet-4", tokenType: "input", tokens: 10 },
  ]);
  assert.deepEqual(second.usage, [
    { model: "claude-sonnet-4", tokenType: "cache_write", tokens: 3 },
    { model: "claude-sonnet-4", tokenType: "output", tokens: 2 },
  ]);
});

test("Codex transcript parser accepts a complete final JSONL record without a newline", () => {
  const parsed = parseCodexTranscript(
    [
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { output_tokens: 7 } } } }),
    ].join("\n"),
  );

  assert.deepEqual(parsed.usage, [
    { model: "gpt-5", tokenType: "output", tokens: 7 },
  ]);
  assert.equal(parsed.pending, "");
});

test("Codex transcript parser pairs turn-context models with token_count last usage only", () => {
  const source = [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4 } } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", usage: { input_tokens: 999 } } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5-mini" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { output_tokens: 3 } } } }),
  ].join("\n");

  assert.deepEqual(parseCodexTranscript(source).usage, [
    { model: "gpt-5", tokenType: "input", tokens: 10 },
    { model: "gpt-5", tokenType: "cached_input", tokens: 2 },
    { model: "gpt-5", tokenType: "output", tokens: 4 },
    { model: "gpt-5-mini", tokenType: "output", tokens: 3 },
  ]);
});

test("Codex parser preserves cached and cache-write token fields", () => {
  const source = [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 10, output_tokens: 4 } } } }),
  ].join("\n");
  assert.deepEqual(parseCodexTranscript(source).usage, [
    { model: "gpt-5", tokenType: "input", tokens: 100 },
    { model: "gpt-5", tokenType: "cached_input", tokens: 60 },
    { model: "gpt-5", tokenType: "cache_write", tokens: 10 },
    { model: "gpt-5", tokenType: "output", tokens: 4 },
  ]);
});

test("pricing override and metrics omit cost for unknown models", () => {
  const pricing = resolvePricing(
    { "gpt-5": { input: 2, output: 8, cached_input: 1 } },
    { "gpt-5": { input: 3, output: 9 } },
  );
  const payload = buildMetricsPayload("codex", [
    { model: "gpt-5", tokenType: "input", tokens: 1000000 },
    { model: "unknown", tokenType: "output", tokens: 10 },
  ], pricing);

  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.equal(metrics[0].name, "agent_usage_tokens");
  assert.equal(metrics[0].sum.dataPoints.length, 2);
  assert.equal(metrics[1].name, "agent_usage_cost_usd");
  assert.deepEqual(metrics[1].sum.dataPoints[0].asDouble, 3);
  assert.deepEqual(
    metrics[0].sum.dataPoints[0].attributes,
    [
      { key: "agent", value: { stringValue: "codex" } },
      { key: "model", value: { stringValue: "gpt-5" } },
      { key: "token_type", value: { stringValue: "input" } },
    ],
  );
  for (const metric of metrics) {
    for (const point of metric.sum.dataPoints) {
      assert.match(point.timeUnixNano, /^[1-9][0-9]*$/);
      assert.match(point.startTimeUnixNano, /^[1-9][0-9]*$/);
    }
  }
});

test("worker serializes updates and retains accrued costs when pricing changes", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000000 } } } }),
  ].join("\n"));
  const posted = [];
  const options = {
    stateFile,
    root: "",
    pricing: { "gpt-5": { input: 2 } },
    post: async (payload) => posted.push(payload),
    now: () => 1700000000000,
  };

  await Promise.all([
    processUsageExport("codex", { transcript_path: transcript }, options),
    processUsageExport("codex", { transcript_path: transcript }, options),
  ]);
  let state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.codex[0].tokens, 1000000);
  assert.equal(state.totals.codex[0].costUsd, 2);
  assert.match(state.totals.codex[0].startTimeUnixNano, /^[1-9][0-9]*$/);
  assert.match(state.costStartTimes.codex["gpt-5"], /^[1-9][0-9]*$/);

  await writeFile(transcript, `${await readFile(transcript, "utf8")}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000000 } } } })}\n`);
  await processUsageExport("codex", { transcript_path: transcript }, {
    ...options,
    pricing: { "gpt-5": { input: 3 } },
  });
  state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.codex[0].tokens, 2000000);
  assert.equal(state.totals.codex[0].costUsd, 5);
  assert.equal(state.costStartTimes.codex["gpt-5"], "1700000000000000000");
  assert.equal(posted.at(-1).resourceMetrics[0].scopeMetrics[0].metrics[1].sum.dataPoints[0].asDouble, 5);
});

test("worker bills only uncached input when input totals include cache tokens", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000000, cached_input_tokens: 700000, cache_write_input_tokens: 100000, output_tokens: 1000000 } } } }),
  ].join("\n"));
  await processUsageExport("codex", { transcript_path: transcript }, {
    stateFile,
    root: "",
    pricing: { "gpt-5": { input: 2, cached_input: 1, cache_write: 3, output: 4 } },
    post: async () => {},
    now: () => 1700000000000,
  });
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.codex.find((point) => point.tokenType === "input").costUsd, 0.4);
  assert.equal(state.totals.codex.find((point) => point.tokenType === "cached_input").costUsd, 0.7);
  assert.equal(state.totals.codex.find((point) => point.tokenType === "cache_write").costUsd, 0.3);
  assert.equal(state.totals.codex.find((point) => point.tokenType === "output").costUsd, 4);
});

test("bundled pricing supports the current GPT-5.6 model variants", async () => {
  const pricing = JSON.parse(await readFile(join("plugins", "agent-usage-exporter", "pricing.json"), "utf8"));
  assert.deepEqual(pricing["gpt-5.6-sol"], { input: 5, cached_input: 0.5, cache_write: 6.25, output: 30 });
  assert.deepEqual(pricing["gpt-5.6-terra"], { input: 2.5, cached_input: 0.25, cache_write: 3.125, output: 15 });
  assert.deepEqual(pricing["gpt-5.6-luna"], { input: 1, cached_input: 0.1, cache_write: 1.25, output: 6 });
});

test("bundled pricing includes DeepSeek peak and off-peak USD tiers", async () => {
  const pricing = JSON.parse(await readFile(join("plugins", "agent-usage-exporter", "pricing.json"), "utf8"));
  assert.deepEqual(pricing["deepseek-v4-flash"], {
    peak_hours: [{ start: 9, end: 12 }, { start: 14, end: 18 }],
    off_peak: { input: 0.2226, cached_input: 0.0074, output: 0.6677 },
    peak: { input: 0.4451, cached_input: 0.0148, output: 1.3353 },
  });
  assert.deepEqual(pricing["deepseek-v4-pro"], {
    peak_hours: [{ start: 9, end: 12 }, { start: 14, end: 18 }],
    off_peak: { input: 0.6677, cached_input: 0.0223, output: 2.003 },
    peak: { input: 1.3353, cached_input: 0.0445, output: 4.0059 },
  });
  assert.equal(pricing.peak_hours, undefined);
});

test("costForUsagePoint applies peak and off-peak rates by local hour", () => {
  const pricing = {
    "deepseek-v4-flash": {
      peak_hours: [{ start: 9, end: 12 }, { start: 14, end: 18 }],
      off_peak: { input: 1.5, cached_input: 0.05, output: 4.5 },
      peak: { input: 3.0, cached_input: 0.10, output: 9.0 },
    },
  };
  const point = { model: "deepseek-v4-flash", tokenType: "input", tokens: 1000000 };
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 10, 0)), 3.0);
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 12, 0)), 1.5);
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 15, 0)), 3.0);
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 20, 0)), 1.5);
});

test("flat pricing entries ignore time tiers", () => {
  const pricing = { "gpt-5": { input: 1.25, output: 10 } };
  const point = { model: "gpt-5", tokenType: "input", tokens: 1000000 };
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 10, 0)), 1.25);
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 22, 0)), 1.25);
});

test("peak hours support midnight-wrapping ranges", () => {
  const pricing = {
    "deepseek-v4-pro": {
      peak_hours: [{ start: 22, end: 2 }],
      off_peak: { input: 4.5, output: 13.5 },
      peak: { input: 9.0, output: 27.0 },
    },
  };
  const point = { model: "deepseek-v4-pro", tokenType: "input", tokens: 1000000 };
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 23, 0)), 9.0);
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 1, 0)), 9.0);
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 12, 0)), 4.5);
});

test("malformed peak hours fall back to off-peak rates", () => {
  const pricing = {
    "deepseek-v4-flash": {
      peak_hours: [{ start: "banana", end: 12 }, { start: 9, end: 24 }, { start: 7, end: 8 }],
      off_peak: { input: 1.5 },
      peak: { input: 3.0 },
    },
  };
  const point = { model: "deepseek-v4-flash", tokenType: "input", tokens: 1000000 };
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 10, 0)), 1.5);
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 7, 30)), 3.0);
});

test("tiered models without peak hours bill off-peak", () => {
  const pricing = {
    "deepseek-v4-flash": {
      off_peak: { input: 1.5 },
      peak: { input: 3.0 },
    },
  };
  const point = { model: "deepseek-v4-flash", tokenType: "input", tokens: 1000000 };
  assert.equal(costForUsagePoint(point, pricing, new Date(2026, 7, 14, 10, 0)), 1.5);
});

test("metrics payload prices a session by its export hour", () => {
  const pricing = {
    "deepseek-v4-flash": {
      peak_hours: [{ start: 9, end: 12 }],
      off_peak: { input: 1.5, output: 4.5 },
      peak: { input: 3.0, output: 9.0 },
    },
  };
  const usage = [
    { model: "deepseek-v4-flash", tokenType: "input", tokens: 1000000 },
    { model: "deepseek-v4-flash", tokenType: "output", tokens: 1000000 },
  ];
  const peak = buildMetricsPayload("claude-code", usage, pricing,
    String(BigInt(new Date(2026, 7, 14, 10, 0).getTime()) * 1000000n));
  const peakPoints = peak.resourceMetrics[0].scopeMetrics[0].metrics[1].sum.dataPoints;
  assert.equal(peakPoints.reduce((sum, point) => sum + point.asDouble, 0), 12);
  const peakTypes = peakPoints.flatMap((p) => p.attributes.map((a) => [a.key, a.value.stringValue]));
  assert.ok(peakTypes.some(([k, v]) => k === "token_type" && v === "input"));
  assert.ok(peakTypes.some(([k, v]) => k === "token_type" && v === "output"));
  const off = buildMetricsPayload("claude-code", usage, pricing,
    String(BigInt(new Date(2026, 7, 14, 13, 0).getTime()) * 1000000n));
  const offPoints = off.resourceMetrics[0].scopeMetrics[0].metrics[1].sum.dataPoints;
  assert.equal(offPoints.reduce((sum, point) => sum + point.asDouble, 0), 6);
});

test("worker prices a session by the local export hour", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "deepseek-v4-flash" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000000 } } } }),
  ].join("\n"));
  const posted = [];
  await processUsageExport("codex", { transcript_path: transcript }, {
    stateFile,
    root: "",
    pricing: {
      "deepseek-v4-flash": {
        peak_hours: [{ start: 9, end: 12 }],
        off_peak: { input: 1.5 },
        peak: { input: 3.0 },
      },
    },
    now: () => new Date(2026, 7, 14, 10, 30).getTime(),
    post: async (metrics) => { posted.push(metrics); },
  });
  const cost = posted[0].resourceMetrics[0].scopeMetrics[0].metrics[1].sum.dataPoints[0].asDouble;
  assert.equal(cost, 3);
});

test("cost points omit the currency attribute", () => {
  const pricing = {
    "gpt-5": { input: 1.25, output: 10 },
    "deepseek-v4-flash": { input: 1.5 },
  };
  const usage = [
    { model: "gpt-5", tokenType: "input", tokens: 1 },
    { model: "deepseek-v4-flash", tokenType: "input", tokens: 1 },
  ];
  const payload = buildMetricsPayload("codex", usage, pricing);
  const costKeys = payload.resourceMetrics[0].scopeMetrics[0].metrics[1].sum.dataPoints
    .flatMap((point) => point.attributes.map((a) => a.key));
  assert.ok(costKeys.includes("agent"));
  assert.ok(costKeys.includes("model"));
  assert.ok(costKeys.includes("token_type"));
  assert.ok(!costKeys.includes("currency"));
});

test("resolveProjectName uses the git root basename", () => {
  const root = mkdtempSync(join(tmpdir(), "aue-proj-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "src", "app"), { recursive: true });
  assert.equal(resolveProjectName(join(root, "src", "app")), basename(root));
  assert.equal(resolveProjectName(root), basename(root));
});

test("resolveProjectName treats a .git file as a git root", () => {
  const root = mkdtempSync(join(tmpdir(), "aue-proj-"));
  writeFileSync(join(root, ".git"), "gitdir: ../.git/modules/x\n");
  assert.equal(resolveProjectName(join(root, "sub", "deep")), basename(root));
});

test("resolveProjectName falls back to the working directory basename", () => {
  const root = mkdtempSync(join(tmpdir(), "aue-proj-"));
  assert.equal(resolveProjectName(join(root, "a", "b")), "b");
});

test("worker exports the project attribute", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10 } } } }),
  ].join("\n"));
  const posted = [];
  await processUsageExport("codex", { transcript_path: transcript }, {
    stateFile,
    root: "",
    pricing: { "gpt-5": { input: 1 } },
    project: "ticdc",
    post: async (metrics) => { posted.push(metrics); },
  });
  const metrics = posted[0].resourceMetrics[0].scopeMetrics[0].metrics;
  const tokenAttrs = metrics[0].sum.dataPoints[0].attributes;
  assert.deepEqual(tokenAttrs.at(-1), { key: "project", value: { stringValue: "ticdc" } });
  const costAttrs = metrics[1].sum.dataPoints[0].attributes;
  assert.ok(costAttrs.some((a) => a.key === "project" && a.value.stringValue === "ticdc"));
});

test("host hook registration and environment gates never cross-launch Codex and Claude", () => {
  const hooks = JSON.parse(readFileSync(join("plugins", "agent-usage-exporter", "hooks", "hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["SessionEnd", "Stop"]);
  assert.match(hooks.hooks.Stop[0].hooks[0].command, /host-launcher\.mjs" codex/);
  assert.match(hooks.hooks.SessionEnd[0].hooks[0].command, /host-launcher\.mjs" claude-code/);
  assert.equal(isExpectedHost("codex", { PLUGIN_ROOT: "/plugin" }), true);
  assert.equal(isExpectedHost("codex", { CLAUDE_PLUGIN_ROOT: "/plugin" }), false);
  assert.equal(isExpectedHost("claude-code", { CLAUDE_PLUGIN_ROOT: "/plugin" }), true);
  assert.equal(isExpectedHost("claude-code", { PLUGIN_ROOT: "/plugin" }), false);
});

test("worker retains an uncommitted cursor when the OTLP post fails", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { output_tokens: 9 } } } }),
  ].join("\n"));
  await assert.rejects(processUsageExport("codex", { transcript_path: transcript }, {
    stateFile,
    root: "",
    pricing: { "gpt-5": { output: 1 } },
    post: async () => { throw new Error("collector unavailable"); },
  }));
  let posted;
  await processUsageExport("codex", { transcript_path: transcript }, {
    stateFile,
    root: "",
    pricing: { "gpt-5": { output: 1 } },
    post: async (payload) => { posted = payload; },
  });
  assert.equal(posted.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asInt, "9");
});

test("worker resets a transcript cursor after truncation", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  const options = { stateFile, root: "", pricing: { "gpt-5": { output: 1 }, "gpt-5-mini": { output: 1 } }, post: async () => {} };
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { output_tokens: 999 } } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "x".repeat(1000) } }),
  ].join("\n"));
  await processUsageExport("codex", { transcript_path: transcript }, options);
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5-mini" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { output_tokens: 2 } } } }),
  ].join("\n"));
  await processUsageExport("codex", { transcript_path: transcript }, options);
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.codex.find((point) => point.model === "gpt-5-mini").tokens, 2);
});

test("native worker parsers are idempotent and retry uncommitted sessions", async () => {
  const fixtures = join("plugins", "agent-usage-exporter", "tests", "fixtures");
  const cases = [
    ["claude-code", "claude-code-session.jsonl", { transcript_path: "session.jsonl" }],
    ["pi", "pi-session.jsonl", { session_path: "session.jsonl" }],
    ["oh-my-pi", "oh-my-pi-session.jsonl", { session_path: "session.jsonl" }],
  ];
  for (const [agent, fixture, payload] of cases) {
    const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
    const transcript = join(stateDirectory, "session.jsonl");
    const stateFile = join(stateDirectory, "state.json");
    await writeFile(transcript, await readFile(join(fixtures, fixture), "utf8"));
    const agentPayload = Object.fromEntries(Object.entries(payload).map(([key]) => [key, transcript]));
    let posts = 0;
    const options = { stateFile, root: "", pricing: {}, post: async () => { posts += 1; } };
    await processUsageExport(agent, agentPayload, options);
    await processUsageExport(agent, agentPayload, options);
    assert.equal(posts, 1, `${agent} must not re-export a committed session`);

    await writeFile(transcript, `${await readFile(transcript, "utf8")}\n${agent === "claude-code"
      ? JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4", usage: { output_tokens: 2 } } })
      : JSON.stringify({ type: "message", message: { role: "assistant", usage: { output: 2 } } })}\n`);
    await assert.rejects(processUsageExport(agent, agentPayload, { ...options, post: async () => { throw new Error("collector unavailable"); } }));
    await processUsageExport(agent, agentPayload, options);
    assert.equal(posts, 2, `${agent} must retry an uncommitted cursor`);

    await writeFile(transcript, `${agent === "claude-code"
      ? JSON.stringify({ type: "assistant", message: { model: "claude-haiku-4", usage: { output_tokens: 1 } } })
      : `${JSON.stringify({ type: "model_change", model: "truncated-model" })}\n${JSON.stringify({ type: "message", message: { role: "assistant", usage: { output: 1 } } })}`}\n`);
    await processUsageExport(agent, agentPayload, options);
    assert.equal(posts, 3, `${agent} must restart after session truncation`);
  }
});

test("Claude worker does not re-export an assistant response repeated after its cursor", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  const response = JSON.stringify({ type: "assistant", message: { id: "msg_repeat", model: "claude-sonnet-4", usage: { output_tokens: 7 } } });
  await writeFile(transcript, `${response}\n`);
  let posts = 0;
  const options = { stateFile, root: "", pricing: {}, post: async () => { posts += 1; } };

  await processUsageExport("claude-code", { transcript_path: transcript }, options);
  await writeFile(transcript, `${response}\n${response}\n`);
  await processUsageExport("claude-code", { transcript_path: transcript }, options);

  assert.equal(posts, 1);
});

test("Claude worker replaces progressive response snapshots across cursors", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  const partial = JSON.stringify({ type: "assistant", message: { id: "msg_progress", model: "claude-sonnet-4", usage: { input_tokens: 10, output_tokens: 0 } } });
  const terminal = JSON.stringify({ type: "assistant", message: { id: "msg_progress", model: "claude-sonnet-4", usage: { input_tokens: 10, cache_creation_input_tokens: 3, output_tokens: 7 } } });
  await writeFile(transcript, partial);
  const options = { stateFile, root: "", pricing: { "claude-sonnet-4": { input: 2, cached_input: 1, cache_write: 3, output: 4 } }, post: async () => {} };

  await processUsageExport("claude-code", { transcript_path: transcript }, options);
  await writeFile(transcript, `${partial}\n${terminal}`);
  await processUsageExport("claude-code", { transcript_path: transcript }, options);

  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals["claude-code"].find((point) => point.tokenType === "input").tokens, 13);
  assert.equal(state.totals["claude-code"].find((point) => point.tokenType === "input").costUsd, 0.00002);
  assert.equal(state.totals["claude-code"].find((point) => point.tokenType === "cache_write").tokens, 3);
  assert.equal(state.totals["claude-code"].find((point) => point.tokenType === "output").tokens, 7);
});

test("worker namespaces cursors by host before reading a shared transcript path", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, `${JSON.stringify({ type: "message", message: { role: "assistant", model: "model-a", usage: { output: 1 } } })}\n`);
  const options = { stateFile, root: "", pricing: {}, post: async () => {} };

  await processUsageExport("pi", { session_path: transcript }, options);
  await processUsageExport("oh-my-pi", { session_path: transcript }, options);

  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.pi[0].tokens, 1);
  assert.equal(state.totals["oh-my-pi"][0].tokens, 1);
  assert.equal(Object.keys(state.cursors).length, 2);
});

test("worker migrates a legacy path-only cursor without re-exporting it", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  const content = `${JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { output_tokens: 1 } } } })}\n`;
  await writeFile(transcript, content);
  await writeFile(stateFile, JSON.stringify({
    cursors: { [transcript]: { offset: Buffer.byteLength(content), model: "gpt-5" } },
    totals: {},
    costStartTimes: {},
  }));

  await processUsageExport("codex", { transcript_path: transcript }, { stateFile, root: "", post: async () => assert.fail("must not post") });

  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.cursors[transcript], undefined);
  assert.equal(state.cursors[`codex\u0000${transcript}`].offset, Buffer.byteLength(content));
});

test("Pi extension uses an event path or the session-manager fallback", async () => {
  const extension = await readFile(join("plugins", "agent-usage-exporter", "extensions", "agent-usage-exporter.ts"), "utf8");
  assert.match(extension, /event\?\.session_path \|\| event\?\.sessionPath \|\| ctx\?\.sessionManager\?\.getSessionFile\?\./);
  assert.match(extension, /session_path: sessionPath/);
  assert.match(extension, /session_shutdown/);
  const ompExtension = await readFile(join("plugins", "agent-usage-exporter", "extensions", "agent-usage-exporter-omp.ts"), "utf8");
  assert.match(ompExtension, /session_stop/);
});

test("worker aggregates cache classes by model before billing uncached input", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10 } } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 20, cached_input_tokens: 25 } } } }),
  ].join("\n"));
  await processUsageExport("codex", { transcript_path: transcript }, {
    stateFile,
    root: "",
    pricing: { "gpt-5": { input: 2, cached_input: 1 } },
    post: async () => {},
  });
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.codex.find((point) => point.tokenType === "input").costUsd, 0.00001);
});

test("worker does not subtract cache classes from non-Codex input", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, [
    JSON.stringify({ type: "model_change", provider: "deepseek", modelId: "deepseek-v4-pro" }),
    JSON.stringify({ type: "message", message: { role: "assistant", model: "deepseek-v4-pro", usage: { input: 100, cacheRead: 70, output: 4 } } }),
  ].join("\n"));
  await processUsageExport("pi", { session_path: transcript }, {
    stateFile,
    root: "",
    pricing: { "deepseek-v4-pro": { input: 2, cached_input: 1, output: 4 } },
    post: async () => {},
  });
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.pi.find((point) => point.tokenType === "input").tokens, 170);
  assert.equal(state.totals.pi.find((point) => point.tokenType === "input").costUsd, 0.0002);
});

test("unknown-priced native worker usage emits no cost point", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  await writeFile(transcript, `${JSON.stringify({ type: "model_change", model: "unknown" })}\n${JSON.stringify({ type: "message", message: { role: "assistant", usage: { output: 4 } } })}`);
  let payload;
  await processUsageExport("pi", { session_path: transcript }, {
    stateFile,
    root: "",
    pricing: {},
    post: async (value) => { payload = value; },
  });
  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.equal(metrics[0].sum.dataPoints.length, 1);
  assert.equal(metrics[1].sum.dataPoints.length, 0);
});

test("state lock reclaims stale locks and bounds an active lock wait", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const stateFile = join(stateDirectory, "state.json");
  const lockFile = `${stateFile}.lock`;
  await writeFile(lockFile, "stale");
  await utimes(lockFile, new Date(0), new Date(0));
  assert.equal(await withStateLock(stateFile, async () => "recovered", { maxWaitMs: 50, staleMs: 1 }), "recovered");

  await writeFile(lockFile, "active");
  await assert.rejects(
    withStateLock(stateFile, async () => {}, { maxWaitMs: 20, staleMs: 60_000 }),
    /State lock busy/,
  );
});

test("state lock keeps a live action past its stale threshold", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const stateFile = join(stateDirectory, "state.json");
  let release;
  const held = withStateLock(stateFile, async () => new Promise((resolve) => { release = resolve; }), { staleMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    withStateLock(stateFile, async () => {}, { maxWaitMs: 50, staleMs: 20 }),
    /State lock busy/,
  );
  release();
  await held;
});

test("worker cursor follows the bytes actually read when a transcript grows during read", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "agent-usage-exporter-"));
  const transcript = join(stateDirectory, "session.jsonl");
  const stateFile = join(stateDirectory, "state.json");
  const initial = `${JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } })}\n`;
  const appended = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { output_tokens: 7 } } } });
  await writeFile(transcript, initial);
  const options = {
    stateFile,
    root: "",
    pricing: { "gpt-5": { output: 1 } },
    post: async () => {},
    readTranscript: async () => Buffer.from(`${initial}${appended}\n`),
  };
  await processUsageExport("codex", { transcript_path: transcript }, options);
  await writeFile(transcript, `${initial}${appended}\n`);
  await processUsageExport("codex", { transcript_path: transcript }, { ...options, readTranscript: undefined });
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(state.totals.codex[0].tokens, 7);
});
