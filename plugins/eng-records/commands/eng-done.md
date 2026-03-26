---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Mark current session as done and generate an engineering review document
user-invocable: true
---

# /eng-done — Mark Session Done & Generate Review

You are helping the user finalize an engineering session record and create a review document.

## Resolving Paths

First, read `~/.claude/eng-records.conf` to get the configured directories. If the file doesn't exist, use defaults:
- `RECORDS_DIR`: `~/.claude/eng-records/records`
- `REVIEWS_DIR`: `~/.claude/eng-records/reviews`

## Steps

1. **Find the current session's record file:**
   - Search for files matching the current session ID in the RECORDS_DIR
   - Use `grep -rl "session_id: $SESSION_ID"` or search for the most recent `status: active` file
   - If you can't determine the session ID, find the most recently modified `.md` file in the records directory

2. **Read the full record file** to understand what happened in the session.

3. **Update the record's frontmatter:** Change `status: active` to `status: done`.

4. **Generate or update the review document:**
   - Check REVIEWS_DIR for an existing review that covers the same project/work
   - If one exists, update it with new information from this session
   - If not, create a new review doc

5. **Review doc format** — use the template below. The goal is to produce a document that showcases engineering strength, leadership, and impact for behavioral interviews and promotion packets. Be specific, use concrete details from the session, and frame accomplishments assertively.

```markdown
---
project: <project name>
date_range: <first session date> — <last session date>
status: draft
tags: [relevant tech/skill tags]
---

# <Descriptive Title of the Work>

## Context
<What was the situation? What problem needed solving? Why was it important? Frame the stakes — what would happen if this wasn't done or was done poorly?>

## Complexity & Scale
<Why was this work hard? What made it non-trivial? Consider: system complexity, ambiguity, tight constraints, cross-cutting concerns, scale of impact, number of components touched, risk of regression. This section justifies why the work required senior-level judgment.>

## Decisions & Trade-offs
<For each significant decision:>
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
<If the session involved meaningful use of AI agents or tooling, document it here. Focus on how AI was used as a force multiplier — not just "used AI to write code." Look for: using agents for parallel research across codebases, running specialized review agents (code quality, error handling, type design) concurrently, building AI-native automation/tooling for the team, and actively directing/steering agent work (pushing back on incorrect suggestions, providing constraints agents couldn't infer, synthesizing agent output into decisions). This section demonstrates the engineer's ability to leverage AI strategically while maintaining human judgment over outcomes. Skip this section if AI usage was routine/unremarkable.>

## Impact & Outcome
<What was the result? Quantify where possible (performance gains, bugs prevented, time saved, scope of systems affected). Describe the before/after. What improved for users, the team, or the system? What future work was unblocked?>

## Key Strengths Demonstrated
<Bullet list framed as behavioral evidence. For each strength, briefly note the situation and action that demonstrated it. Examples: system design, debugging under pressure, trade-off analysis, technical communication, risk management, simplifying complexity, delivering under constraints.>
```

6. **Tell the user** the paths to both the updated record and the review doc.
