# Project Rules

## Prompt Logging

**Scope:** Main/controller session only. Subagents dispatched via the Agent/Task tool or Superpowers skills (
`/subagent-driven-development`, `/executing-plans`) MUST NOT write to or modify `prompts.txt` — their task briefs are
not user prompts, and logging them pollutes the file with noise and out-of-order timestamps.

**This is a hard rule with no exceptions: only the main/controller agent may append to `prompts.txt`.**

After completing each user-initiated response, append one entry to `prompts.txt` in the project root:

```
<ISO 8601 timestamp> | PROMPT: "<verbatim prompt text>" | SUMMARY: <brief summary of what you did>
```

Rules:

- Use verbatim prompt text. Truncate only if extremely long, with a trailing `[...]`.
- Get the real timestamp via `date -u +%Y-%m-%dT%H:%M:%SZ` — never use a placeholder.
- Write the entry **after** the response is complete so the summary reflects all work done, including any subagents
  dispatched.
- Create the file if it doesn't exist. Maintain strict chronological order across all sessions.

---

## Commit Conventions

All commits must follow the rules defined in `CONVENTIONAL_COMMIT_GUIDELINE.md`, which is the single source of truth
for:

- Commit message format (Conventional Commits)
- Allowed types and scopes
- Summary and body formatting rules
- Commit splitting strategy
- Pull request description structure

**`CONVENTIONAL_COMMIT_GUIDELINE.md` takes precedence over any inline instructions in case of conflict.**
