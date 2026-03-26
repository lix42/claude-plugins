---
description: Generate or update an engineering review document from a session record file. Use when the user says things like "create a review doc", "write up the engineering review", "generate review from record", or "update the review doc for this work".
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
user-invocable: false
---

# Create Engineering Review Document

You are helping the user create or update an engineering review document from session record files. These review docs are used for behavioral interviews and promotion documents, so focus on engineering decisions, trade-offs, and demonstrated skills.

## Resolving Paths

First, read `~/.claude/eng-records.conf` to get the configured directories. If the file doesn't exist, use defaults:
- `RECORDS_DIR`: `~/.claude/eng-records/records`
- `REVIEWS_DIR`: `~/.claude/eng-records/reviews`

## Input

The user may provide:
- A specific record file path
- A session name or partial match
- Nothing (use the most recent active/done record)

## Process

1. **Find and read** the record file(s). If the user specifies a name, search frontmatter `name:` fields. Otherwise use the most recent file.

2. **Check for existing review:** Search REVIEWS_DIR for a doc covering the same project or work topic. If found, you'll update it rather than create a new one.

3. **Analyze the session record** for:
   - Key engineering decisions and why they were made
   - Trade-offs considered
   - Problems encountered and how they were solved
   - Technical patterns and approaches used
   - **Complexity signals:** What made the work non-trivial? Ambiguity, system scope, risk, constraints
   - **Leadership signals:** Ownership, initiative, driving direction, autonomous judgment, risk identification, setting patterns, proposing better approaches
   - **Impact signals:** Quantifiable outcomes, before/after improvements, what was unblocked
   - **AI-augmentation signals:** Using agents for parallel research, running specialized review agents, building AI-native tooling/automation, directing agent work with human judgment (pushing back, providing constraints, synthesizing output)
   - Skills demonstrated (system design, debugging, performance optimization, etc.)

   When writing, be assertive and specific. Frame accomplishments in terms of the engineering judgment and strength they demonstrate. This document is used for behavioral interviews and promotion packets — it should make the engineer look strong.

4. **Write the review doc** using this structure:

```markdown
---
project: <project name>
date_range: <first session date> — <last session date>
status: draft
tags: [relevant tech/skill tags]
sessions: [list of source record filenames]
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

5. **If updating an existing review:** Merge new information into existing sections. Add new decisions, challenges, etc. Update the date range and sessions list. Don't duplicate content.

6. **Name the review file** descriptively: `<project>_<brief-topic>.md` (e.g., `tv_auth-middleware-rewrite.md`)

7. Tell the user the review doc path and give a brief summary of what was captured.
