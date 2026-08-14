import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMetricsPayload,
  costForUsagePoint,
  defaultStateDirectory,
  loadJson,
  loadPricing,
  parseClaudeCodeTranscript,
  parseCodexTranscript,
  parsePiTranscript,
  postMetrics,
  resolveProjectName,
  withStateLock,
  writeJsonAtomically,
} from "../lib/exporter.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function codexUsage(payload, state, options = {}) {
  return transcriptUsage("codex", payload.transcript_path || payload.transcriptPath || process.env.CODEX_TRANSCRIPT_PATH, state, parseCodexTranscript, options);
}

function sessionPath(agent, payload) {
  if (agent === "claude-code") return payload.transcript_path || payload.transcriptPath;
  return payload.session_path || payload.sessionPath || payload.transcript_path || payload.transcriptPath;
}

async function transcriptUsage(agent, transcript, state, parser, options = {}) {
  if (!transcript) return [];
  let metadata;
  try {
    metadata = await stat(transcript);
  } catch {
    return [];
  }
  const cursorKey = `${agent}\u0000${transcript}`;
  const legacyCursor = state.cursors?.[transcript];
  const cursor = state.cursors?.[cursorKey] || legacyCursor || { offset: 0 };
  const offset = metadata.size < cursor.offset ? 0 : cursor.offset;
  const fileContent = options.readTranscript
    ? await options.readTranscript(transcript)
    : await readFile(transcript);
  const content = fileContent.subarray(offset).toString("utf8");
  const parsed = parser(content, offset ? cursor.model : undefined, offset ? cursor.responses : undefined);
  state.cursors ||= {};
  state.cursors[cursorKey] = {
    offset: offset + Buffer.byteLength(content) - Buffer.byteLength(parsed.pending),
    pending: parsed.pending,
    model: parsed.model,
    responses: parsed.responses,
  };
  if (legacyCursor) delete state.cursors[transcript];
  return parsed.usage;
}

async function nativeSessionUsage(agent, payload, state, options = {}) {
  if (agent === "codex") return codexUsage(payload, state, options);
  const parser = agent === "claude-code" ? parseClaudeCodeTranscript : parsePiTranscript;
  return transcriptUsage(agent, sessionPath(agent, payload), state, parser, options);
}

function normalizeUsage(agent, usage) {
  const modelTokens = new Map();
  for (const point of usage) {
    const totals = modelTokens.get(point.model) || { input: 0, cached_input: 0, cache_write: 0 };
    if (Object.hasOwn(totals, point.tokenType)) totals[point.tokenType] += point.tokens;
    modelTokens.set(point.model, totals);
  }
  const firstInputs = new Set();
  const normalized = [];
  for (const point of usage) {
    if (point.tokenType !== "input") {
      normalized.push(point);
      continue;
    }
    const totals = modelTokens.get(point.model);
    if (firstInputs.has(point.model)) {
      normalized.push({ ...point, billableTokens: 0 });
      continue;
    }
    firstInputs.add(point.model);
    const cacheTokens = totals.cached_input + totals.cache_write;
    normalized.push({
      ...point,
      tokens: agent === "codex" ? point.tokens : point.tokens + cacheTokens,
      billableTokens: agent === "codex"
        ? Math.max(0, totals.input - cacheTokens)
        : totals.input,
    });
  }
  if (agent !== "codex") {
    for (const [model, totals] of modelTokens) {
      if (!firstInputs.has(model) && (totals.cached_input || totals.cache_write)) {
        normalized.unshift({
          model,
          tokenType: "input",
          tokens: totals.cached_input + totals.cache_write,
          billableTokens: 0,
        });
      }
    }
  }
  return normalized;
}

function updateTotals(state, agent, usage, pricing, timestamp) {
  state.totals ||= {};
  state.costStartTimes ||= {};
  state.costStartTimes[agent] ||= {};
  const totals = new Map((state.totals[agent] || []).map((point) => [
    `${point.model}\u0000${point.tokenType}`,
    point,
  ]));
  for (const point of normalizeUsage(agent, usage)) {
    const { billableTokens, ...metricPoint } = point;
    const key = `${metricPoint.model}\u0000${metricPoint.tokenType}`;
    const previous = totals.get(key);
    const billedPoint = metricPoint.tokenType === "input" && Number.isFinite(billableTokens)
      ? { ...metricPoint, tokens: billableTokens }
      : metricPoint;
    const incrementCost = costForUsagePoint(billedPoint, pricing, new Date(Number(timestamp) / 1e6));
    const hasCost = previous?.hasCost || Number.isFinite(incrementCost);
    if (hasCost && !state.costStartTimes[agent][metricPoint.model]) {
      state.costStartTimes[agent][metricPoint.model] = timestamp;
    }
    totals.set(key, {
      ...previous,
      ...metricPoint,
      tokens: (previous?.tokens || 0) + metricPoint.tokens,
      startTimeUnixNano: previous?.startTimeUnixNano || timestamp,
      costUsd: (previous?.costUsd || 0) + (incrementCost || 0),
      hasCost,
    });
  }
  state.totals[agent] = [...totals.values()];
}

export async function processUsageExport(agent, payload, options = {}) {
  if (!new Set(["codex", "claude-code", "pi", "oh-my-pi"]).has(agent)) return;
  const stateFile = options.stateFile || join(defaultStateDirectory(options.env), "state.json");
  const now = options.now || Date.now;
  return withStateLock(stateFile, async () => {
    const state = await loadJson(stateFile, { cursors: {}, totals: {}, costStartTimes: {} });
    const usage = await nativeSessionUsage(agent, payload, state, options);
    if (!usage.length) {
      await writeJsonAtomically(stateFile, state);
      return;
    }
    const pricing = options.pricing || await loadPricing(options.root || root, options.env);
    const timestamp = (BigInt(now()) * 1000000n).toString();
    const project = options.project || resolveProjectName(process.cwd());
    updateTotals(state, agent, usage, pricing, timestamp);
    const metrics = buildMetricsPayload(
      agent,
      state.totals[agent],
      pricing,
      timestamp,
      state.costStartTimes[agent],
      project,
    );
    await (options.post || postMetrics)(metrics);
    await writeJsonAtomically(stateFile, state);
  });
}

async function main() {
  const agent = argument("--agent");
  if (!agent) return;
  let payload = {};
  try {
    payload = JSON.parse(Buffer.from(argument("--payload") || "", "base64url").toString());
  } catch {
    return;
  }
  await processUsageExport(agent, payload);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {});
