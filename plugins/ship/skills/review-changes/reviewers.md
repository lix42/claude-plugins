# Reviewer registry

The reviewers `review-changes` can launch. Each row is one agent bundled in this
plugin's `agents/` directory, launched as `ship:<name>`. The default model is the
agent's frontmatter `model:`; this table repeats it so the orchestrator can
reason about overrides without opening every agent file. Keep the two in sync.

To add a reviewer, see `docs/adding-a-reviewer.md` at the plugin root.

| Agent | Focus | Runs when | Default model |
|---|---|---|---|
| `review-bugs` | Logic errors, edge cases, async and concurrency, resource leaks, broken callers | Any change to code, executable prose, or config | opus |
| `review-security` | Injection, trust boundaries, authorization, secrets, unsafe shell or deserialization | **Security signal** in the diff | opus |
| `review-error-handling` | Silent failures, swallowed errors, fallbacks that mask a failure, missing cleanup | **Error-handling signal** in the diff | sonnet |
| `review-tests` | Coverage gaps for new behavior, tests that cannot fail, brittle tests | New or changed behavior in source, or test files changed | sonnet |
| `review-conventions` | Codified project rules and the local idiom | Any change, unless the scope is small | sonnet |
| `review-types` | Type invariants, illegal states, encapsulation, public type contracts | **Type signal** in the diff | sonnet |
| `review-docs` | Comments, docstrings and docs the change made wrong, or that a docs change got wrong | **Docs signal** in the diff | sonnet |

## Signals

Judge signals from the diff's added and removed lines, not from file names
alone.

- **Executable prose.** Skill, agent, command, and prompt files (`SKILL.md`,
  `agents/*.md`, `commands/*.md`, system prompts) are instructions a model
  carries out. Treat them as code for `review-bugs` and `review-conventions`,
  and as documentation for `review-docs`.
- **Security signal.** User or network input parsed or forwarded; SQL, shell,
  `eval`, templates, or file paths built from data; authentication,
  authorization, sessions, tokens, cookies, or secrets; CORS, CSP, or headers;
  crypto; new dependencies; CI workflow permissions; content from outside the
  repository (web pages, PR comments, tool output) that a prompt treats as
  instructions.
- **Error-handling signal.** `try`/`catch`/`finally`, `.catch(`, `except`,
  `rescue`, `Result`/`Option` handling, `|| default` or `?? fallback` on a call's
  result, retries, timeouts, exit codes, or `set -e` changes.
- **Type signal.** New or changed `type`, `interface`, `class`, `enum`, struct,
  schema, or exported function signature.
- **Docs signal.** Changed comments or docstrings; changed documentation or
  executable-prose files; or a renamed or removed function, flag, file, or
  command that a nearby comment or doc names.

## Scope size

Count changed lines (added plus removed), including untracked files in a
working-tree scope, and excluding lockfiles, generated files, and snapshots.

- **Small** — 30 lines or fewer, typically one fix inside `drive-pr` or a
  rebase adaptation.
- **Large** — more than 400 lines, or more than 15 files.
- **Normal** — anything between.
