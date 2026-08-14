import { mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

export const TOKEN_FIELDS = [
  ["input", ["input_tokens", "inputTokens"]],
  ["cached_input", ["cached_input_tokens", "cachedInputTokens", "cache_read_input_tokens"]],
  ["cache_write", ["cache_write_input_tokens", "cacheWriteInputTokens", "cache_creation_input_tokens"]],
  ["output", ["output_tokens", "outputTokens"]],
];

function tokenCounts(lastTokenUsage) {
  const tokens = {};
  for (const [tokenType, fields] of TOKEN_FIELDS) {
    tokens[tokenType] = fields.map((field) => lastTokenUsage[field]).find(Number.isFinite) || 0;
  }
  return tokens;
}

function usageFromTokenCounts(tokens, model, target) {
  for (const [tokenType] of TOKEN_FIELDS) {
    if (tokens[tokenType] > 0) target.push({ model, tokenType, tokens: tokens[tokenType] });
  }
}

function usageFromLastTokenUsage(lastTokenUsage, model, target) {
  if (!model || !lastTokenUsage || typeof lastTokenUsage !== "object") return;
  usageFromTokenCounts(tokenCounts(lastTokenUsage), model, target);
}

function usageDelta(current, previous, model, previousModel, target) {
  if (previousModel && previousModel !== model) {
    for (const [tokenType] of TOKEN_FIELDS) {
      if (previous[tokenType] > 0) target.push({ model: previousModel, tokenType, tokens: -previous[tokenType] });
    }
    usageFromTokenCounts(current, model, target);
    return;
  }
  for (const [tokenType] of TOKEN_FIELDS) {
    const delta = current[tokenType] - (previous[tokenType] || 0);
    if (delta) target.push({ model, tokenType, tokens: delta });
  }
}

// Codex records the model in turn_context and the per-turn delta in event_msg.
// Do not recursively scan transcript payloads: they can contain unrelated usage objects.
export function parseCodexTranscript(source, initialModel) {
  const lines = source.split("\n");
  const finalLine = lines.pop() || "";
  const usage = [];
  let model = initialModel;
  const parseLine = (line) => {
    if (!line.trim()) return true;
    try {
      const record = JSON.parse(line);
      if (record.type === "turn_context" && typeof record.payload?.model === "string") {
        model = record.payload.model;
      } else if (record.type === "event_msg" && record.payload?.type === "token_count") {
        usageFromLastTokenUsage(record.payload.info?.last_token_usage, model, usage);
      }
      return true;
    } catch {
      return false;
    }
  };
  for (const line of lines) parseLine(line);
  const pending = parseLine(finalLine) ? "" : finalLine;
  return { usage, pending, model };
}

function parseJsonlTranscript(source, initialModel, consume) {
  const lines = source.split("\n");
  const finalLine = lines.pop() || "";
  const usage = [];
  let model = initialModel;
  const parseLine = (line) => {
    if (!line.trim()) return true;
    try {
      model = consume(JSON.parse(line), model, usage) || model;
      return true;
    } catch {
      return false;
    }
  };
  for (const line of lines) parseLine(line);
  const pending = parseLine(finalLine) ? "" : finalLine;
  return { usage, pending, model };
}

export function parseClaudeCodeTranscript(source, initialModel, initialResponses = {}) {
  const responses = { ...initialResponses };
  const parsed = parseJsonlTranscript(source, initialModel, (record, model, usage) => {
    if (record.type !== "assistant" || typeof record.message?.model !== "string"
      || !record.message.usage || typeof record.message.usage !== "object") return model;
    const messageId = record.message.id;
    if (typeof messageId !== "string") {
      usageFromLastTokenUsage(record.message.usage, record.message.model, usage);
      return record.message.model;
    }
    const tokens = tokenCounts(record.message.usage);
    const previous = responses[messageId] || { tokens: {} };
    usageDelta(tokens, previous.tokens, record.message.model, previous.model, usage);
    responses[messageId] = { model: record.message.model, tokens };
    return record.message.model;
  });
  return { ...parsed, responses };
}

export function parsePiTranscript(source, initialModel) {
  return parseJsonlTranscript(source, initialModel, (record, model, usage) => {
    if (record.type === "model_change") {
      if (typeof record.provider === "string" && typeof record.modelId === "string") {
        return `${record.provider}/${record.modelId}`;
      }
      if (typeof record.model === "string") return record.model;
    }
    const messageModel = typeof record.message?.model === "string" ? record.message.model : model;
    if (record.type !== "message" || record.message?.role !== "assistant" || !messageModel) return model;
    const usageData = record.message.usage;
    if (!usageData || typeof usageData !== "object") return model;
    const fields = [
      ["input", "input"],
      ["cached_input", "cacheRead"],
      ["cache_write", "cacheWrite"],
      ["output", "output"],
    ];
    for (const [tokenType, field] of fields) {
      const tokens = usageData[field];
      if (Number.isFinite(tokens) && tokens > 0) usage.push({ model: messageModel, tokenType, tokens });
    }
    return messageModel;
  });
}

export function resolvePricing(bundled, override) {
  const merged = { ...bundled, ...(override || {}) };
  const aliases = { ...(bundled._aliases || {}), ...(override?._aliases || {}) };
  if (Object.keys(aliases).length) merged._aliases = aliases;
  return merged;
}

export function resolveProjectName(cwd = process.cwd()) {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return basename(dir);
    const parent = dirname(dir);
    if (parent === dir) return basename(cwd);
    dir = parent;
  }
}

function attributes(agent, model, tokenType, project) {
  const result = [
    { key: "agent", value: { stringValue: agent } },
    { key: "model", value: { stringValue: model } },
  ];
  if (tokenType) result.push({ key: "token_type", value: { stringValue: tokenType } });
  if (project) result.push({ key: "project", value: { stringValue: project } });
  return result;
}

function nowUnixNano(now = Date.now()) {
  return (BigInt(now) * 1000000n).toString();
}

function aggregateUsage(usage) {
  const totals = new Map();
  for (const point of usage) {
    const key = `${point.model}\u0000${point.tokenType}`;
    const previous = totals.get(key);
    totals.set(key, previous
      ? { ...previous, tokens: previous.tokens + point.tokens }
      : { ...point });
  }
  return totals;
}

function parsePeakHours(peakHours = []) {
  return peakHours.map((range) => {
    if (!range || typeof range !== "object") return null;
    const start = Number(range.start);
    const end = Number(range.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || start > 23 || end < 0 || end > 23) return null;
    return { start, end };
  }).filter(Boolean);
}

function isPeakHour(when, peakHours = []) {
  const ranges = parsePeakHours(peakHours);
  if (!ranges.length) return false;
  const hour = when.getHours();
  return ranges.some(({ start, end }) => start <= end
    ? hour >= start && hour < end
    : hour >= start || hour < end);
}

export function costForUsagePoint(point, pricing, when = new Date()) {
  const pricedModel = pricing[point.model] ? point.model : pricing._aliases?.[point.model];
  const entry = pricing[pricedModel];
  if (!entry) return undefined;
  const rates = entry.peak || entry.off_peak
    ? (isPeakHour(when, entry.peak_hours) ? entry.peak : entry.off_peak)
    : entry;
  const rate = rates?.[point.tokenType];
  return Number.isFinite(rate) ? (point.tokens * rate) / 1000000 : undefined;
}

export function buildMetricsPayload(agent, usage, pricing, timestamp = nowUnixNano(), costStartTimes = {}, project) {
  const tokenPoints = [];
  const costTotals = new Map();
  const when = new Date(Number(timestamp) / 1e6);
  for (const point of aggregateUsage(usage).values()) {
    const startTimeUnixNano = point.startTimeUnixNano || timestamp;
    tokenPoints.push({
      attributes: attributes(agent, point.model, point.tokenType, project),
      startTimeUnixNano,
      timeUnixNano: timestamp,
      asInt: String(point.tokens),
    });
    const hasStoredCost = Object.hasOwn(point, "hasCost");
    const cost = Object.hasOwn(point, "costUsd")
      ? point.costUsd
      : costForUsagePoint(point, pricing, when);
    if (hasStoredCost ? point.hasCost : Number.isFinite(cost)) {
      const costKey = `${point.model}\u0000${point.tokenType}`;
      const previous = costTotals.get(costKey);
      costTotals.set(costKey, {
        model: point.model,
        tokenType: point.tokenType,
        cost: (previous?.cost || 0) + (cost || 0),
        startTimeUnixNano: costStartTimes[point.model]
          || previous?.startTimeUnixNano
          || startTimeUnixNano,
      });
    }
  }
  const costPoints = [...costTotals.values()].map((value) => ({
    attributes: attributes(agent, value.model, value.tokenType, project),
    startTimeUnixNano: value.startTimeUnixNano,
    timeUnixNano: timestamp,
    asDouble: value.cost,
  }));
  return {
    resourceMetrics: [{
      resource: { attributes: [] },
      scopeMetrics: [{
        scope: { name: "agent-usage-exporter" },
        metrics: [
          {
            name: "agent_usage_tokens",
            description: "Cumulative tokens consumed by coding agents.",
            unit: "1",
            sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: tokenPoints },
          },
          {
            name: "agent_usage_cost_usd",
            description: "Estimated cumulative coding-agent usage cost in USD.",
            unit: "USD",
            sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: costPoints },
          },
        ],
      }],
    }],
  };
}

export function defaultStateDirectory(env = process.env) {
  return env.AGENT_USAGE_STATE_DIR
    || join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "agent-usage-exporter");
}

export async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomically(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export async function withStateLock(stateFile, action, options = {}) {
  const lockFile = `${stateFile}.lock`;
  const maxWaitMs = options.maxWaitMs ?? 10_000;
  const staleMs = options.staleMs ?? 30_000;
  const started = Date.now();
  await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      const lock = await open(lockFile, "wx", 0o600);
      const owner = { pid: process.pid, token: `${process.pid}-${Date.now()}-${Math.random()}` };
      await lock.writeFile(`${JSON.stringify(owner)}\n`);
      const heartbeat = setInterval(() => {
        utimes(lockFile, new Date(), new Date()).catch(() => {});
      }, Math.max(10, Math.floor(staleMs / 3)));
      try {
        return await action();
      } finally {
        clearInterval(heartbeat);
        await lock.close();
        await rm(lockFile, { force: true });
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let lockInfo;
      try {
        lockInfo = await stat(lockFile);
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - lockInfo.mtimeMs > staleMs) {
        let owner;
        try {
          owner = JSON.parse(await readFile(lockFile, "utf8"));
        } catch {}
        let ownerIsLive = false;
        if (Number.isInteger(owner?.pid) && owner.pid > 0) {
          try {
            process.kill(owner.pid, 0);
            ownerIsLive = true;
          } catch (ownerError) {
            ownerIsLive = ownerError?.code === "EPERM";
          }
        }
        if (!ownerIsLive) {
          await rm(lockFile, { force: true });
          continue;
        }
      }
      if (Date.now() - started >= maxWaitMs) {
        throw new Error("State lock busy");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

export async function loadPricing(root, env = process.env) {
  const bundled = await loadJson(join(root, "pricing.json"), {});
  const override = env.AGENT_USAGE_PRICING_FILE
    ? await loadJson(env.AGENT_USAGE_PRICING_FILE, {})
    : {};
  return resolvePricing(bundled, override);
}

export async function postMetrics(payload, endpoint = process.env.AGENT_USAGE_OTLP_ENDPOINT || "http://127.0.0.1:4318/v1/metrics") {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`OTLP endpoint returned ${response.status}`);
}
