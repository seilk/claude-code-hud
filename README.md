# claude-code-hud

A standalone status line HUD for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — no plugins or dependencies required.

Displays rate limits, session time, and context window usage directly in the Claude Code status bar.

```
5h:[###-----]42%(55m) wk:[#####---]60%(3d12h) s/o:32% | session:3m | ctx:[###-----]42%
```

## What it shows

| Element | Description |
|---------|-------------|
| `5h:` | 5-hour rate limit usage with progress bar and reset time |
| `wk:` | Weekly rate limit usage with progress bar and reset time |
| `s/o:` | Per-model weekly usage (Sonnet / Opus) |
| `session:` | Current session duration |
| `ctx:` | Context window usage |

Colors indicate severity: green (normal), yellow (>70%), red (>85%).

## Requirements

- Node.js 18+
- Claude Code with OAuth login (Pro/Max plan)

## Setup

1. Copy `hud.mjs` to `~/.claude/hud/`:

```bash
mkdir -p ~/.claude/hud
cp hud.mjs ~/.claude/hud/hud.mjs
```

2. Update `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /absolute/path/to/.claude/hud/hud.mjs"
  }
}
```

> **Note:** Use an absolute path (not `~`). Claude Code does not expand `~` in the command field.

3. Restart Claude Code.

## How it works

Claude Code pipes a JSON object via stdin to the status line command on each update (~300ms). The script:

1. Parses stdin JSON for context window and session data
2. Fetches rate limits from Anthropic's OAuth usage API (`api.anthropic.com/api/oauth/usage`)
3. Caches API responses for 30 seconds to avoid excessive calls
4. Renders a single-line output with ANSI colors

Credentials are read from `~/.claude/.credentials.json` (auto-created by Claude Code on OAuth login). On macOS, Keychain is checked first.

## License

MIT
