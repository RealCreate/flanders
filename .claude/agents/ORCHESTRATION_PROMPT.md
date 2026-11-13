# Orchestrator prompt (paste into the main Claude Code session)

Requires `implementer.md`, `code-reviewer.md` and `security-reviewer.md` in `.claude/agents/`
(project) or `~/.claude/agents/` (all projects).

```text
Execute docs/plan.md using subagents. You are the orchestrator and arbiter.

1. Split the plan into slices with NO overlapping files. List each slice with its owned
   files before starting. If two slices need the same file, merge them or sequence them.
2. Spawn one `implementer` subagent per independent slice, in parallel. Give each one its
   slice, the relevant plan section, and the exact files it may edit. Sequence any slice
   that depends on another slice's output.
3. When an implementer finishes, spawn a FRESH `code-reviewer` subagent for that slice
   (give it the changed files and the plan section, not the implementer's reasoning).
   For slices touching auth, input handling or data access, also spawn `security-reviewer`.
   Run reviewers in parallel across slices.
4. If a reviewer returns REQUEST CHANGES, send the blocking issues back to a new
   `implementer` for that slice, then re-review. Maximum 2 fix rounds per slice, then
   escalate to me with both sides of the disagreement.
5. As arbiter, check each blocking issue yourself before acting on it. Reviewers can be
   wrong. Overrule with a stated reason when needed.
6. Finish with a cross-slice check: run the full test suite and build yourself, and confirm
   the slices integrate. Then give me a summary: slices done, review verdicts, issues
   overruled, anything unresolved.

Do not implement anything yourself. Do not commit or push.
```
