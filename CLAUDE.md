# Project Rules

## Prompt Logging

Scope: this applies only to prompts the human user sends directly in the main/controller session. Do not apply it
inside dispatched subagents (e.g. via the Agent/Task tool, or the superpowers subagent-driven-development /
executing-plans skills) — a subagent's dispatch instructions are not a new user prompt, and subagents logging their
own task briefs pollutes this file with noise and out-of-order timestamps.

**Subagents MUST NOT write to or modify `prompts.txt` under any circumstances. This is a hard rule with no exceptions.
Only the main/controller agent is authorized to append entries to this file.**

Every time the user sends a new instruction or prompt, append one entry to prompts.txt in the project root, in this
format:

```
<ISO 8601 timestamp> | PROMPT: "<verbatim prompt text>" | SUMMARY: <brief summary of what you did in response>
```

- Use the verbatim prompt text, not a paraphrase. Truncate only if extremely long, with a trailing `[...]`.
- Use the real current timestamp (e.g. via `date -u +%Y-%m-%dT%H:%M:%SZ`) — never a placeholder.
- Write one entry per user prompt, after the response is complete, so the summary reflects the full work done
  (including any subagents dispatched along the way).
- Create the file if it doesn't exist. Keep this log updated throughout all sessions, in chronological order.

## Commit Conventions

All commits must follow the rules defined in:

- `CONVENTIONAL_COMMIT_GUIDELINE.md`

This file contains the full specification for:

- Commit message format (Conventional Commits)
- Allowed types and scopes
- Summary and body formatting rules
- Commit splitting strategy
- Pull request description structure

If any conflict exists between this file and inline instructions, `CONVENTIONAL_COMMIT_GUIDELINE.md` takes precedence.
