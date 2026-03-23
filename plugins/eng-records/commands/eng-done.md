---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Mark current session as done and generate an engineering review document
user-invocable: true
---

# /eng-done — Mark Session Done & Generate Review

You are helping the user finalize an engineering session record and create a review document.

## Steps

1. **Find the current session's record file:**
   - Search for files matching the current session ID in: `/Users/li.xu/Library/CloudStorage/GoogleDrive-devlix42@gmail.com/My Drive/Documents/engineering/records/`
   - Use `grep -rl "session_id: $SESSION_ID"` or search for the most recent `status: active` file
   - If you can't determine the session ID, find the most recently modified `.md` file in the records directory

2. **Read the full record file** to understand what happened in the session.

3. **Update the record's frontmatter:** Change `status: active` to `status: done`.

4. **Generate or update the review document:**
   - Check `/Users/li.xu/Library/CloudStorage/GoogleDrive-devlix42@gmail.com/My Drive/Documents/engineering/reviews/` for an existing review that covers the same project/work
   - If one exists, update it with new information from this session
   - If not, create a new review doc

5. **Review doc format** — use the template below, focusing on engineering decisions and skills demonstrated:

```markdown
---
project: <project name>
date_range: <first session date> — <last session date>
status: draft
tags: [relevant tech/skill tags]
---

# <Descriptive Title of the Work>

## Context
<What was the situation? What problem needed solving? Why was it important?>

## Decisions & Trade-offs
<For each significant decision:>
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
<Bullet list of engineering competencies shown: system design, debugging, trade-off analysis, etc.>
```

6. **Tell the user** the paths to both the updated record and the review doc.
