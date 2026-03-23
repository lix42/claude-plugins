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
   - Skills demonstrated (system design, debugging, performance optimization, etc.)

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
<What was the situation? What problem needed solving? Why was it important?>

## Decisions & Trade-offs
### Decision: <what was decided>
- **Options considered:** <alternatives>
- **Rationale:** <why this choice>
- **Trade-offs:** <what was gained/sacrificed>

## Technical Approach
<How was the work implemented? What patterns, tools, techniques were used?>

## Challenges & Problem-Solving
<What obstacles came up? How were they resolved?>

## Impact & Outcome
<What was the result? What improved?>

## Skills Demonstrated
<Bullet list of engineering competencies shown>
```

5. **If updating an existing review:** Merge new information into existing sections. Add new decisions, challenges, etc. Update the date range and sessions list. Don't duplicate content.

6. **Name the review file** descriptively: `<project>_<brief-topic>.md` (e.g., `tv_auth-middleware-rewrite.md`)

7. Tell the user the review doc path and give a brief summary of what was captured.
