# Adding a reviewer

`review-changes` is an orchestrator: it profiles a change, picks reviewer agents
from a registry, chooses each one's model, runs them in parallel, and merges
their reports. Adding a reviewer — say, a CSS reviewer — means writing one
agent and registering it. The orchestrator itself does not change.

| File | Role |
|---|---|
| `agents/review-<area>.md` | The reviewer: its focus and what is out of scope |
| `skills/review-changes/reviewers.md` | The registry: when each reviewer runs, its default model, the signals |
| `skills/review-changes/reviewer-contract.md` | Shared by every reviewer: scope, verification, reporting bar, output format |
| `skills/review-changes/SKILL.md` | The orchestrator: selection rules, model overrides, merging |

## 1. Decide whether it is a new reviewer

Add a reviewer for a **distinct area of expertise** with its own failure modes —
CSS and layout, accessibility, database migrations, performance, i18n. Extend
an existing reviewer's checklist instead when the concern is a variation of one
it already owns: a new class of injection belongs in `review-security`, not a
reviewer of its own.

Every reviewer costs a subagent run on each review it is selected for, so it
needs a trigger narrow enough that it runs only on changes it can say something
about.

## 2. Pick the default model

Choose by how much judgment the review takes, not by how important the area is:

- **opus** — reasoning across files or about behavior: whether logic is
  correct, whether data can reach a sink, whether a contract still holds.
- **sonnet** — the default. Applying a known checklist to code with judgment:
  conventions, tests, docs, error handling, most domain reviewers.
- **haiku** — mechanical checks with little judgment and a low false-positive
  cost: forbidden patterns, a naming scheme, missing required fields. The
  orchestrator never raises a reviewer to haiku, and only keeps one there
  when it is the registry default.

The orchestrator may raise or lower the model per review (see **3. Select
reviewers and models** in `SKILL.md`), so pick the model that fits the typical
change, not the hardest one.

## 3. Write the agent

Create `agents/review-<area>.md`. Copy an existing reviewer — `review-docs.md`
is a short one — and replace its focus:

```markdown
---
name: review-css
description: Use this agent to review the CSS and layout side of one local change — <the failure modes it finds>. It is one of the specialized reviewers the bundled `review-changes` skill launches in parallel when <its trigger>, and it expects that skill's brief — a scope, the git commands producing it, and the reviewer contract to follow. It reports only; it never edits files, commits, or comments on GitHub.
model: sonnet
color: pink
tools: Read, Grep, Glob, Bash
---

You review one local change for <area>. First read the reviewer contract whose
path the brief gives you, and follow it for scope, verification, the reporting
bar, and the output format. If the brief gives no contract path, review
`git diff` plus `git diff --staged` and report each finding with its location,
problem, and fix, at the same 80-confidence bar.

## What to look for

- **<Category>.** <Concrete defects, specific enough to check.>

## Out of scope

<What the other reviewers cover, and preferences that are below the bar.>
```

Rules for the agent file:

- **Name** it `review-<area>`. It is launched as `ship:review-<area>`.
- **Keep it read-only.** `tools: Read, Grep, Glob, Bash` — never `Edit` or
  `Write`. The caller fixes; reviewers only report.
- **Keep the contract paragraph** verbatim. Scope handling, the 80-confidence
  bar, severities, and the output format come from `reviewer-contract.md`;
  never restate or change them in an agent, or the orchestrator can no longer
  merge its report with the others.
- **Make "What to look for" concrete** — defects a reviewer can verify against
  the code, not virtues to aspire to.
- **Fence the lane** in "Out of scope", naming the reviewers that own the
  neighboring areas, so findings do not overlap.

## 4. Register it

Add a row to the table in `skills/review-changes/reviewers.md`:

```markdown
| `review-css` | Specificity wars, layout breakage, unused or duplicated rules, theme tokens bypassed | **Style signal** in the diff | sonnet |
```

Keep the **Default model** column equal to the agent's frontmatter `model:`.
When the trigger is not just "files of a type changed", define a signal under
**Signals** — judged from the diff's lines, not only file names:

```markdown
- **Style signal.** Changed `.css`, `.scss`, or `.less` files; `style`,
  `className`, or `styled`/`css` template literals in components; design-token
  or theme files.
```

Add a selection or model rule to `SKILL.md`'s **3. Select reviewers and
models** only when the new reviewer needs behavior the existing rules do not
give it — for example, a reviewer that should still run on a small scope.

## 5. Check it

1. **Lint the plugin.** Run the `plugin-dev:plugin-validator` agent on
   `plugins/ship`, and check the registry and frontmatter agree:

   ```bash
   grep -H '^model:' plugins/ship/agents/review-*.md
   ```

2. **Run it on a change it should catch.** Make a small change with a planted
   defect in its area and run `/review-changes`. Confirm the launch line selects
   the reviewer with the expected model, its report follows the contract, and
   the merged report includes the defect.
3. **Run it on a change it should skip.** Confirm the launch line leaves it out.
4. **Document it.** Add it to the reviewer list in the ship section of the
   repository `README.md`, and bump the plugin version in both
   `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.
