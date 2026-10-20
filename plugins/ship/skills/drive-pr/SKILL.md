---
name: drive-pr
description: >-
  Drive an open GitHub pull request to green: watch checks and fix failures,
  rebase when it falls behind its base, address review comments, and reply to
  and resolve every handled thread — reviewing each fix locally before it is
  pushed. Use when the user invokes $drive-pr or /drive-pr, asks to babysit,
  drive, or fix up a PR, get a PR green, or address PR review comments,
  including PRs that were not opened by ship. Never merges.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
---

# Drive PR

In OpenCode, load bundled workflows with the `skill` tool using exact IDs
`ship`, `review-changes`, and `rebase`, not Claude's `ship:*` names below.

Carry an open pull request to green: checks passing, branch current with its
base, and review feedback handled. Invoking this workflow authorizes its normal
outward actions on that pull request: pushing to its branch, replying to its
comments, and resolving its review threads.

Obey two hard rules:

- Never push past a failing quality gate. Fix it and rerun the gate; if an
  unrelated pre-existing failure cannot safely be fixed, stop for the user.
- Never merge the pull request. Leave the final merge to the user.

Inputs, from the user or the calling workflow:

- **The pull request** — a number or URL. When none is given, use the current
  branch's pull request.
- **`--mark-ready`** — mark a draft ready for review once it is green. Without
  it, a draft stays a draft: a PR the user opened as a draft may be one on
  purpose. `ship` passes it, because its own drafts are an intermediate state.

## Set up

1. **Find the pull request.**

   ```bash
   gh pr view [<number or url>] --json number,url,state,isDraft,headRefName,baseRefName,isCrossRepository,maintainerCanModify,headRepositoryOwner
   ```

   Stop when there is none or it is not `OPEN`. Suggest `/ship` (`$ship` in
   Codex) when the user has an unpublished change instead.

2. **Start from a clean working tree.** Fixes are reviewed as working-tree
   changes and the branch may be rebased, so unrelated edits would be reviewed as
   part of a fix and would block the rebase. If `git status --porcelain` shows
   anything, list it and ask the user to commit or stash it, or to let this
   workflow run `git stash push --include-untracked` and `git stash pop` it at
   the end. Never stash without that yes. When `ship` invoked this workflow,
   these are the changes it left unstaged as unrelated to the PR — say so.

3. **Check out its branch.** Fixes are made locally, so the PR's head branch
   must be checked out in the current worktree.
   - Run `gh pr view --json number` with no argument. If it reports this PR,
     the current branch is its head → continue. Matching `headRefName` alone is
     not enough: a PR from a fork's `main` shares its name with the local
     `main`, and fixes would be pushed to the wrong repository.
   - Otherwise run `gh pr checkout <number>`. If the branch is checked out in
     another worktree, stop and name it.
   - Bring the local branch up to date with the PR's remote branch
     (`git pull --ff-only`). If it has diverged, stop rather than overwrite
     either side.

4. **Confirm pushes will land.** A cross-repository PR
   (`isCrossRepository: true`) whose head is not owned by the current
   `gh` user and has `maintainerCanModify: false` cannot be pushed to. Report
   its check and review status, say that fixes cannot be pushed, and stop.

5. **Load the config.** Read the `ship` skill's `config.md` (`../ship/config.md`
   relative to this file) and use the current host's cache exactly as it
   describes — the same cache `ship` uses, with first-run detection when it is
   missing or stale — plus its **live project facts**, read from this worktree.
   This workflow needs `qualityGates`, `skills.ciRepair`, and
   `skills.reviewFeedback`. When `ship` invoked this
   workflow, reuse what it already loaded.

Give the user a one-line summary of the PR and its current state, then loop.

## Review every fix before it is pushed

Each code change this workflow makes — a CI fix, a review-comment fix — is
reviewed locally before it reaches the pull request. A rebase's conflict
resolutions and adaptations are reviewed by the `rebase` skill itself (see
**Loop**).

1. Leave the fix uncommitted, then run every non-null `qualityGates` command it
   could affect. A gate already passed against identical code in this session
   need not be repeated.
2. Review it with the `review-changes` skill bundled with this plugin —
   `ship:review-changes` through the Skill tool in Claude Code,
   `$review-changes` in Codex, or `../review-changes/SKILL.md` relative to this
   file when neither can be invoked — scoped to the working tree, so reviewers
   judge the fix rather than re-reviewing the whole branch. Give it the fix's
   focus: the failing check or the review comments it answers.
3. Act on the report as its **Acting on the report** section describes. Then
   commit and push — unless a critical or important finding is still open,
   which blocks the push until the user decides.

Batch the fixes for one round (every accepted comment, or every failing check)
into a single review and a single push, rather than one cycle per fix. Honor
the repository's commit conventions, and stage only the fix.

A helper may commit and push on its own before this workflow can review. When
`ciRepair` or `reviewFeedback` has already pushed an unreviewed change, review
the pushed commits (`git diff <commit before the helper>..HEAD`) and push any
fixes the review warrants.

## Loop

Repeat until checks pass, the branch is current, and actionable feedback is
handled:

1. **Checks.** Watch with `gh pr checks --watch` or inspect
   `statusCheckRollup`. If checks fail and `skills.ciRepair` is set, invoke that
   exact helper. Otherwise inspect failed logs with `gh`, reproduce locally, and
   fix. Review the fix as above, push, and watch again.
2. **Behind or conflicting.** Read the merge state each pass with
   `gh pr view <number> --json mergeStateStatus`. When it is `BEHIND`, or
   `DIRTY` (conflicts with the base — GitHub may not run checks at all until
   they are resolved):
   - Fetch, and first integrate anything new on the PR's own branch
     (`git pull --ff-only`; stop if it has diverged).
   - Rebase with the `rebase` skill bundled with this plugin — `ship:rebase`
     through the Skill tool in Claude Code, `$rebase` in Codex, or
     `../rebase/SKILL.md` relative to this file when neither can be invoked —
     with `<baseRefName>` as the base, which is not always the default branch.
     It judges how the base's new commits affect this PR, resolves conflicts and
     makes small adaptations itself, brings large ones back for a decision,
     reruns every gate, and reviews any conflict resolution or adaptation.
   - Commit any adaptations it left uncommitted, as a fix.
   - Push with `git push --force-with-lease --force-if-includes`. The second
     flag refuses the push when the remote branch has commits the local branch
     never integrated, which the fetch alone would otherwise let a bare
     `--force-with-lease` overwrite. If the push is refused, someone else
     pushed: integrate their commits, rerun gates, and retry.
   - A large impact the rebase puts to the user is an external blocker until
     they answer; report the PR's state and wait.
3. **Review feedback.** Handle unresolved review threads and actionable PR
   comments; see **Address review feedback**.
4. **Repeat.** Any pushed change restarts check and feedback inspection.
   Continue until green or until a genuine external blocker — a required human
   approval, a failure only the user can fix — requires the user.

## Address review feedback

1. **Collect.** Fetch every review thread with its id — `--paginate` follows
   `pageInfo`, so a PR with more than 100 threads is not silently cut short —
   and the PR's top-level comments and review summaries:

   ```bash
   gh api graphql --paginate --slurp -f owner=<owner> -f repo=<repo> -F pr=<number> -f query='
     query($owner: String!, $repo: String!, $pr: Int!, $endCursor: String) {
       repository(owner: $owner, name: $repo) { pullRequest(number: $pr) {
         reviewThreads(first: 100, after: $endCursor) {
           pageInfo { hasNextPage endCursor }
           nodes {
             id isResolved isOutdated path line
             comments(first: 100) { totalCount nodes { author { login } body } }
           } } } } }'
   gh pr view <number> --json comments,reviews
   ```

   With `--slurp` the output is an array with one response per page; don't add
   `--jq`, which `gh` rejects alongside `--slurp` — pipe to `jq` instead. Skip
   threads that are already resolved. When a thread's `totalCount`
   exceeds the comments returned, fetch the rest before judging it.

   Top-level comments and review summaries have no resolved state, so skip any
   posted before the latest top-level comment by the current `gh` user
   (`gh api user -q .login`): that one already answered them, whether this
   workflow wrote it on an earlier pass or the user did. Skip, too, anything
   with nothing to act on or answer (approvals, empty review bodies, CI-bot
   status posts).

2. **Triage.** Judge each item on its merits rather than accepting it blindly:
   it is either **fixed** (it warrants a change) or **declined** (it does not —
   already handled, out of scope, or mistaken), with a one-line reason. A
   question needs only an answer and counts as declined. If
   `skills.reviewFeedback` is set, invoke that exact helper to triage and
   implement the fixes; this workflow still owns the review, the push, and the
   replies below.

3. **Fix.** Implement every fixed item, then review, commit, and push them
   together as described under **Review every fix before it is pushed**.

4. **Reply and resolve every handled thread**, once the push has landed so the
   reply's commit SHA exists on the remote. Each thread gets a reply and is then
   resolved, declined ones included:
   - fixed — what changed and the short commit SHA; resolve with `ADDRESSED`.
   - declined — the reason no change was made; resolve with `WONT_FIX`.

   ```bash
   gh api graphql -f id=<thread id> -f body=<reply> -f query='
     mutation($id: ID!, $body: String!) {
       addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { url } } }'
   gh api graphql -f id=<thread id> -f query='
     mutation($id: ID!) {
       resolveReviewThread(input: {threadId: $id, resolutionReason: ADDRESSED}) { thread { isResolved } } }'
   ```

   If the API rejects `resolutionReason` (older GitHub Enterprise Server),
   resolve without it. When the helper already replied to or resolved a thread,
   do not reply twice; finish only what it left undone.

5. **Answer top-level feedback.** Top-level PR comments and review summaries
   have no thread to resolve. Answer the actionable ones in one `gh pr comment`
   that addresses each by author, saying what changed (with the SHA) or why not.

## Finish

If this workflow stashed the user's changes, `git stash pop` them; report a
conflict rather than resolving it on the user's behalf.

With `--mark-ready`, mark a draft ready for review only after all checks pass
and all known actionable feedback is addressed (`gh pr ready`). Without it,
leave a draft as a draft and say it is green and still a draft.

Report the PR URL, check status, each pushed fix with its SHA, how many threads
were replied to and resolved (fixed vs declined, with the declined reasons), any
top-level comment answered, and the draft state. Call out anything skipped and
why, and remind the user that the final merge remains theirs.
