# Claude HUD Setup Guide (for Agent)

This document describes how to install and configure claude-hud on a new machine.
An AI agent can follow these steps to replicate the statusline setup automatically.

## Prerequisites

- Node.js 18+ installed
- Claude Code installed
- Git access to this repository

## Step 1: Clone and Build

```bash
git clone -b claude-hud-jarrodwatts git@github.com:seilk/claude-code-hud.git ~/.claude/plugins/claude-hud
cd ~/.claude/plugins/claude-hud
npm ci
npm run build
```

## Step 2: Configure statusLine in settings.json

Add the `statusLine` field to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'exec node ~/.claude/plugins/claude-hud/dist/index.js'"
  }
}
```

If `~/.claude/settings.json` already exists, merge the `statusLine` field into it.
Do not overwrite other existing fields.

## Step 3: Apply config.json

The `config.json` in this repository contains the preferred display settings:

```json
{
  "display": {
    "showUsage": true,
    "usageBarEnabled": true,
    "sevenDayThreshold": 0
  }
}
```

This file is already included in the repo at the root. After cloning, it will be
in place at `~/.claude/plugins/claude-hud/config.json`. No extra copy step needed.

### Config explained

| Key | Value | Effect |
|-----|-------|--------|
| `showUsage` | `true` | Show 5-hour rate limit usage bar |
| `usageBarEnabled` | `true` | Render usage as a visual bar |
| `sevenDayThreshold` | `0` | Always show 7-day weekly usage (default is 80, meaning it only shows at 80%+) |

## Step 4: Restart Claude Code

Restart Claude Code so it picks up the new `statusLine` config.

## Verification

After restart, the statusline should display:

```
[Opus] │ project-name git:(branch*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h) | ░░░░░░░░░░ 5% (3d / 7d)
```

The 7-day usage bar should always be visible (due to `sevenDayThreshold: 0`).
