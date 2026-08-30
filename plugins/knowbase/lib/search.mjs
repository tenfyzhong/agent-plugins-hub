import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function loadConfig() {
  const envUrl = process.env.KNOWBASE_API_URL;
  const envToken = process.env.KNOWBASE_ACCESS_TOKEN;

  if (envUrl && envToken) {
    return {
      apiUrl: envUrl.trim().replace(/\/+$/, "").replace(/\/search$/, ""),
      accessToken: envToken.trim()
    };
  }

  const configPath =
    process.env.KNOWBASE_CONFIG_PATH ||
    path.join(os.homedir(), ".config", "knowbase", "config.json");

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed.apiUrl && parsed.accessToken) {
        return {
          apiUrl: parsed.apiUrl.trim().replace(/\/+$/, "").replace(/\/search$/, ""),
          accessToken: parsed.accessToken.trim()
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function formatResults(response) {
  if (!response.results || response.results.length === 0) {
    return `No results found for "${response.query}".`;
  }

  const lines = [
    `Results for: "${response.query}" (${response.count} matches)\n`
  ];

  response.results.forEach((item, index) => {
    const title = item.title || item.path || item.id;
    lines.push(`[${index + 1}] ${title}`);
    lines.push(`    Source: ${item.source} | Score: ${(item.score || 0).toFixed(3)}`);
    if (item.url) {
      lines.push(`    URL: ${item.url}`);
    } else if (item.path) {
      lines.push(`    Path: ${item.path}`);
    }
    lines.push(`    ----------------------------------------`);
    const preview = item.text && item.text.length > 500 ? `${item.text.slice(0, 500)}...` : item.text || "";
    lines.push(`    ${preview.replace(/\n/g, "\n    ")}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

export async function searchKnowledgeBase(options) {
  const config = loadConfig();
  if (!config) {
    throw new Error(
      "Knowledge Base OAuth credentials not found. Please create '~/.config/knowbase/config.json' or set KNOWBASE_API_URL and KNOWBASE_ACCESS_TOKEN environment variables."
    );
  }

  const url = `${config.apiUrl}/search`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
      "User-Agent": "Knowbase-MCP/1.0"
    },
    body: JSON.stringify({
      query: options.query,
      topK: options.topK || 5,
      source: options.source
    })
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Knowledge Base API error (${res.status}): ${errorBody || res.statusText}`);
  }

  return await res.json();
}
