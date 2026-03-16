#!/usr/bin/env node
/**
 * Standalone Claude Code HUD - No OMC dependency
 * Displays: rate limits (5h/weekly) + session cost + context bar
 *
 * Usage: Set in ~/.claude/settings.json:
 *   { "statusLine": { "type": "command", "command": "node /path/to/.claude/hud/standalone-hud.mjs" } }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import https from "node:https";

// ── ANSI Colors ──────────────────────────────────────────────
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";


function colorByPercent(pct, warnAt = 70, critAt = 85) {
  if (pct >= critAt) return RED;
  if (pct >= warnAt) return YELLOW;
  return GREEN;
}

// ── Progress Bar ─────────────────────────────────────────────
function progressBar(pct, width = 8) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const color = colorByPercent(clamped);
  return `${color}${"#".repeat(filled)}${DIM}${"-".repeat(empty)}${RESET}`;
}

// ── Time Formatting ──────────────────────────────────────────
function formatResetTime(resetDate) {
  if (!resetDate) return null;
  const d = resetDate instanceof Date ? resetDate : new Date(resetDate);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return null;

  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

// ── Read stdin ───────────────────────────────────────────────
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    setTimeout(() => resolve({}), 1000);
  });
}

// ── Context Percent ──────────────────────────────────────────
function getContextPercent(input) {
  if (input.context_window?.used_percentage != null) {
    return Math.round(input.context_window.used_percentage);
  }
  const cw = input.context_window;
  if (cw?.current_usage && cw?.context_window_size) {
    const u = cw.current_usage;
    const total =
      (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    return Math.round(Math.min(100, (total / cw.context_window_size) * 100));
  }
  return 0;
}

// ── Rate Limits via OAuth API ────────────────────────────────
const CACHE_DIR = join(homedir(), ".claude", "hud");
const CACHE_FILE = join(CACHE_DIR, ".usage-cache.json");
const CACHE_TTL_MS = 30_000;
const CACHE_TTL_FAIL_MS = 15_000;
const CREDS_FILE = join(homedir(), ".claude", ".credentials.json");
const API_TIMEOUT_MS = 10_000;
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

function readCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    const ttl = cache.error ? CACHE_TTL_FAIL_MS : CACHE_TTL_MS;
    if (Date.now() - cache.timestamp < ttl) return cache.data;
  } catch {}
  return null;
}

function writeCache(data, error = false) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), data, error }), "utf8");
  } catch {}
}

function getCredentials() {
  try {
    // macOS Keychain
    if (process.platform === "darwin") {
      try {
        const result = execFileSync(
          "/usr/bin/security",
          ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
          { encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }
        ).trim();
        const parsed = JSON.parse(result);
        const creds = parsed.claudeAiOauth || parsed;
        if (creds.accessToken) return creds;
      } catch {}
    }
    // File fallback (Linux/Windows)
    if (existsSync(CREDS_FILE)) {
      const parsed = JSON.parse(readFileSync(CREDS_FILE, "utf8"));
      const creds = parsed.claudeAiOauth || parsed;
      if (creds.accessToken) return { ...creds, _source: "file" };
    }
  } catch {}
  return null;
}

function httpsRequest(options, body) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        } else {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    if (body) req.end(body);
    else req.end();
  });
}

async function refreshToken(refreshTokenStr) {
  if (!refreshTokenStr) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshTokenStr,
    client_id: OAUTH_CLIENT_ID,
  }).toString();

  const data = await httpsRequest({
    hostname: "platform.claude.com",
    path: "/v1/oauth/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: API_TIMEOUT_MS,
  }, body);

  if (!data?.access_token) return null;

  const newCreds = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshTokenStr,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : data.expires_at,
  };

  // Write back to credentials file
  try {
    if (existsSync(CREDS_FILE)) {
      const existing = JSON.parse(readFileSync(CREDS_FILE, "utf8"));
      if (existing.claudeAiOauth) {
        existing.claudeAiOauth.accessToken = newCreds.accessToken;
        existing.claudeAiOauth.expiresAt = newCreds.expiresAt;
        if (newCreds.refreshToken) existing.claudeAiOauth.refreshToken = newCreds.refreshToken;
      }
      const tmpPath = `${CREDS_FILE}.tmp.${process.pid}`;
      writeFileSync(tmpPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
      renameSync(tmpPath, CREDS_FILE);
    }
  } catch {}

  return newCreds;
}

async function fetchUsageFromApi(accessToken) {
  return httpsRequest({
    hostname: "api.anthropic.com",
    path: "/api/oauth/usage",
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
    },
    timeout: API_TIMEOUT_MS,
  });
}

function clamp(v) {
  if (v == null || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function parseUsageResponse(resp) {
  if (!resp) return null;
  const fh = resp.five_hour?.utilization;
  const sd = resp.seven_day?.utilization;
  if (fh == null && sd == null) return null;

  const parseDate = (s) => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  const ss = resp.seven_day_sonnet?.utilization;
  const so = resp.seven_day_opus?.utilization;

  return {
    five_hour: fh != null ? {
      usedPct: Math.round(clamp(fh)),
      resetsAt: parseDate(resp.five_hour?.resets_at),
    } : null,
    seven_day: sd != null ? {
      usedPct: Math.round(clamp(sd)),
      resetsAt: parseDate(resp.seven_day?.resets_at),
    } : null,
    seven_day_sonnet: ss != null ? {
      usedPct: Math.round(clamp(ss)),
      resetsAt: parseDate(resp.seven_day_sonnet?.resets_at),
    } : null,
    seven_day_opus: so != null ? {
      usedPct: Math.round(clamp(so)),
      resetsAt: parseDate(resp.seven_day_opus?.resets_at),
    } : null,
  };
}

async function fetchUsage() {
  const cached = readCache();
  if (cached) return cached;

  let creds = getCredentials();
  if (!creds?.accessToken) return null;

  // Check if expired (expiresAt is numeric ms timestamp)
  if (creds.expiresAt != null && creds.expiresAt <= Date.now()) {
    const refreshed = await refreshToken(creds.refreshToken);
    if (!refreshed) { writeCache(null, true); return null; }
    creds = refreshed;
  }

  const resp = await fetchUsageFromApi(creds.accessToken);
  if (!resp) { writeCache(null, true); return null; }

  const parsed = parseUsageResponse(resp);
  writeCache(parsed, !parsed);
  return parsed;
}

// ── Render ────────────────────────────────────────────────────
function renderRateLimits(usage) {
  if (!usage) return `${DIM}limits: -${RESET}`;
  const parts = [];

  if (usage.five_hour) {
    const used = usage.five_hour.usedPct;
    const time = formatResetTime(usage.five_hour.resetsAt);
    const bar = progressBar(used);
    const color = colorByPercent(used);
    parts.push(`5h:[${bar}]${color}${used}%${RESET}${time ? `${DIM}(${time})${RESET}` : ""}`);
  }

  if (usage.seven_day) {
    const used = usage.seven_day.usedPct;
    const time = formatResetTime(usage.seven_day.resetsAt);
    const bar = progressBar(used);
    const color = colorByPercent(used);
    parts.push(`wk:[${bar}]${color}${used}%${RESET}${time ? `${DIM}(${time})${RESET}` : ""}`);
  }

  // Per-model weekly quotas (s/o = sonnet/opus)
  const s = usage.seven_day_sonnet;
  const o = usage.seven_day_opus;
  if (s || o) {
    const vals = [];
    if (s) { const c = colorByPercent(s.usedPct); vals.push(`${c}${s.usedPct}%${RESET}`); }
    if (o) { const c = colorByPercent(o.usedPct); vals.push(`${c}${o.usedPct}%${RESET}`); }
    parts.push(`s/o:${vals.join(`/`)}`);
  }

  return parts.join(" ") || `${DIM}limits: -${RESET}`;
}

function renderContext(pct) {
  const bar = progressBar(pct);
  const color = colorByPercent(pct);
  return `ctx:[${bar}]${color}${pct}%${RESET}`;
}

function renderSession(input) {
  const durationMs = input.cost?.total_duration_ms;
  const parts = [];

  if (durationMs != null) {
    const mins = Math.floor(durationMs / 60000);
    parts.push(`${GREEN}${mins}m${RESET}`);
  }

  return parts.length ? `session:${parts.join(" ")}` : null;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const [input, usage] = await Promise.all([readStdin(), fetchUsage()]);

  const contextPct = getContextPercent(input);
  const elements = [];

  // Rate limits (5hr + weekly)
  elements.push(renderRateLimits(usage));

  // Session info (duration + cost)
  const session = renderSession(input);
  if (session) elements.push(session);

  // Context bar
  elements.push(renderContext(contextPct));

  // Line 1: usage info
  console.log(elements.join(` ${DIM}|${RESET} `));

  // Line 2: current working directory
  const cwd = input.cwd || process.cwd();
  const home = homedir();
  const display = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const CWD_COLOR = "\x1b[38;2;217;119;87m"; // #d97757
  console.log(`${CWD_COLOR}${display}${RESET}`);
}

main();
