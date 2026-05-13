---
description: Generate or update engineering review documents from one or more session record files. Use when the user says things like "create a review doc", "write up the engineering review", "generate review from record", or "update the review doc for this work".
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
user-invocable: false
---

# Create Engineering Review Document

You are helping the user create or update engineering review documents from session record files. These review docs are used for behavioral interviews and promotion documents, so focus on engineering decisions, trade-offs, and demonstrated skills.

## Resolving Paths

Read `~/.claude/eng-records.conf` to get the configured directories. If the file doesn't exist, use defaults:
- `RECORDS_DIR`: `~/.claude/eng-records/records`
- `REVIEWS_DIR`: `~/.claude/eng-records/reviews`

## Input

You will be given a list of record file paths to review (the caller resolves any user inputs into concrete paths before invoking this skill). If only one record is given, skip the grouping step and write a single review.

## Process

### 1. Read all input records

For each record file, read its frontmatter (`session_id`, `name`, `project`, `started`, `status`, `review`, plus the branch from filename `yyyy-mm-dd-{project}-{branch}-{seq}.md`) and the full body. Hold this in memory for grouping.

### 2. Group records that belong to the same work

Two records belong to the same review when **any** of these is true:

1. **Same `name:`** — both have a non-empty `name:` and they match (case-insensitive). This is the strongest signal because the user set it deliberately.
2. **Same project + branch + adjacent dates** — same `project:` value AND same branch (from filename) AND their `started:` dates are within 7 days of each other.
3. **Same project + clear topical overlap** — same `project:` AND the body content clearly discusses the same feature/bug/files (same file paths touched, same module names, same error being fixed). Apply this rule with judgment; do not merge merely because two sessions touched the same large repo.

Otherwise the records belong to separate reviews.

Apply the rules transitively: if A groups with B, and B groups with C, then {A, B, C} form one group even if A and C don't directly match.

### 3. Print the grouping plan

Before writing anything, output the plan in this form so the user can interrupt if it's wrong:

```
Group 1 (<short label, e.g., the shared name or inferred topic>):
  - <record path>
  - <record path>
  → <review path> (new | update)

Group 2 (<label>):
  - <record path>
  → <review path> (new | update)
```

For each group, decide the review path:
- If any record in the group already has a `review:` pointer in its frontmatter, target that path and `update`.
- Else, search `REVIEWS_DIR` for an existing review whose `sessions:` list overlaps with any record in the group, or whose topic clearly matches. Target that path and `update`.
- Else, create a new path: `<project>_<brief-topic>.md` (e.g., `tv_auth-middleware-rewrite.md`).

### 4. For each group, write or update the review

Analyze the combined records in the group for:
- Key engineering decisions and why they were made
- Trade-offs considered
- Problems encountered and how they were solved
- Technical patterns and approaches used
- **Complexity signals:** ambiguity, system scope, risk, constraints
- **Leadership signals:** ownership, initiative, driving direction, autonomous judgment, risk identification, setting patterns, proposing better approaches
- **Impact signals:** quantifiable outcomes, before/after improvements, what was unblocked
- **AI-augmentation signals:** using agents for parallel research, running specialized review agents, building AI-native tooling/automation, directing agent work with human judgment (pushing back, providing constraints, synthesizing output)
- Skills demonstrated (system design, debugging, performance optimization, etc.)

When writing, be assertive and specific. Frame accomplishments in terms of the engineering judgment and strength they demonstrate. This document is used for behavioral interviews and promotion packets — it should make the engineer look strong.

**Review doc structure:**

```markdown
---
project: <project name>
date_range: <earliest record date> — <latest record date>
status: draft
tags: [relevant tech/skill tags]
sessions: [list of source record filenames, sorted by date]
---

# <Descriptive Title of the Work>

## Context
<What was the situation? What problem needed solving? Why was it important? Frame the stakes — what would happen if this wasn't done or was done poorly?>

## Complexity & Scale
<Why was this work hard? What made it non-trivial? Consider: system complexity, ambiguity, tight constraints, cross-cutting concerns, scale of impact, number of components touched, risk of regression. This section justifies why the work required senior-level judgment.>

## Decisions & Trade-offs
### Decision: <what was decided>
- **Options considered:** <alternatives>
- **Rationale:** <why this choice>
- **Trade-offs:** <what was gained/sacrificed>

## Technical Approach
<How was the work implemented? What patterns, tools, techniques were used? Highlight any clever or elegant solutions.>

## Challenges & Problem-Solving
<What obstacles came up? How were they resolved? Emphasize resourcefulness, debugging skill, and persistence. Include root cause analysis where applicable.>

## Leadership & Influence
<Capture any signals of ownership, initiative, or influence demonstrated during the session. Examples: driving technical direction, making judgment calls under uncertainty, identifying risks proactively, proposing better approaches, taking ownership of ambiguous problems, setting standards or patterns for others to follow. If the work was solo, highlight autonomous decision-making and self-direction.>

## AI-Augmented Engineering
<If the session involved meaningful use of AI agents or tooling, document it here. Focus on how AI was used as a force multiplier — not just "used AI to write code." Look for: using agents for parallel research across codebases, running specialized review agents concurrently, building AI-native automation/tooling for the team, and actively directing/steering agent work (pushing back on incorrect suggestions, providing constraints agents couldn't infer, synthesizing agent output into decisions). This section demonstrates the engineer's ability to leverage AI strategically while maintaining human judgment over outcomes. Skip this section if AI usage was routine/unremarkable.>

## Impact & Outcome
<What was the result? Quantify where possible (performance gains, bugs prevented, time saved, scope of systems affected). Describe the before/after. What improved for users, the team, or the system? What future work was unblocked?>

## Key Strengths Demonstrated
<Bullet list framed as behavioral evidence. For each strength, briefly note the situation and action that demonstrated it. Examples: system design, debugging under pressure, trade-off analysis, technical communication, risk management, simplifying complexity, delivering under constraints.>
```

**If updating an existing review:** merge new information into existing sections — add new decisions, challenges, and strengths rather than replacing. Update `date_range` to span all records, extend `sessions:` with the new filenames (deduped, sorted), and don't duplicate content.

### 5. Stamp each consumed record with the review pointer

After writing the review for a group, update each source record's frontmatter to add (or overwrite):

```yaml
review: <absolute path to the review file>
```

This makes re-runs idempotent and lets `/eng-review` with no arguments find un-reviewed records by looking for records missing the `review:` key.

### 6. Report to the user

For each group, print:
- The review path and whether it was created or updated.
- A one-sentence summary of what was captured.
- The list of records stamped with the back-pointer.
