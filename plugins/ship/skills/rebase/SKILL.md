---
name: rebase
description: >-
  Bring the current branch up to date with its base: rebase when it is behind,
  and judge how the base's new commits affect the branch's change — whether it
  can be simplified, now fights upstream's direction, or needs extra parts —
  whether or not git reports conflicts. Small impacts are adapted
  automatically; large ones come back for a decision. Use when the user invokes
  $rebase or /rebase, or asks to rebase, update, or sync a branch with main or
  its base. Ship and drive-pr use it for every rebase. Never pushes.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
---

# Rebase

In OpenCode, load `ship`, `review-fix-loop`, `review-changes`, and `rebase` by
exact ID using the `skill` tool; Claude's `ship:*` names below do not apply.

Bring the current branch up to date with its base without losing what either
side meant. A rebase can be conflict-free and still leave the change wrong —
upstream may have added the helper the branch reimplements, or a new caller the
branch's change must also cover — and a conflict can be pure noise. So the
base's new commits are always weighed against the branch's change, and the
weight decides who adapts it:

- **none or small impact** — the bundled `rebase-scout` agent, on a cheaper
  model, rebases and makes the mechanical adaptations itself;
- **large impact** — the scout changes nothing and reports, and this workflow
  decides how to adapt, asking the user when the choice is theirs.

This workflow rewrites the local branch's history but never pushes. Pushing
belongs to the caller: `ship` and `drive-pr` push, and a standalone `/rebase`
leaves it to the user.

Inputs, from the user or the calling workflow:

- **Base** — the branch to rebase onto. When none is given: the base of the
  current branch's open pull request (`gh pr view --json baseRefName`), else
  the default branch. A stacked branch's base is not the default branch, and
  rebasing it onto the default branch would pull in its parent's commits.
- **Working-tree change** — whether uncommitted work is part of the change.
  `ship` says yes: its change is not committed yet.
- **Verification** — whether the caller runs the quality gates and a
  working-tree review over the result next, as `ship` does before its review
  loop. Then **Verify** here skips the gates and reviews only conflict
  resolutions that landed in rebased commits, which a working-tree review
  cannot see.

## 1. Check whether a rebase is needed

1. **Default branch.** Read the `ship` skill's `config.md` (`../ship/config.md`
   relative to this file) and take `environment.defaultBranch` from the current
   host's cache, running first-run detection as it describes when the cache is
   missing or stale. When a calling workflow already loaded the config, reuse
   it.
2. **Working tree.** If `git status --porcelain` shows anything and the caller
   has not said it is part of the change, list it and ask the user whether to
   commit it, stash it themselves, or let this workflow stash and restore it.
   Never stash without that yes.
3. **Target ref.** When `environment.hasGitHubRemote` is true, find the remote
   that hosts the base: the one whose URL points at the repository `gh`
   targets (`gh repo view --json nameWithOwner -q .nameWithOwner`) — not
   necessarily `origin`, which in a fork's clone is the fork. Fetch it and
   target `<remote>/<base>`: the branch will be pushed against the remote base,
   so unpushed commits on the local `<base>` must not ride along. Otherwise —
   no GitHub remote, where `ship` fast-forwards the local `<base>` afterwards —
   fetch when `<base>` tracks a remote, since a fetch moves only the tracking
   ref, and target whichever of `<base>` and `<base>@{upstream}` contains the
   other; the local `<base>` alone when it has no upstream. When the two have
   diverged, stop and ask the user which the branch belongs on.
4. **Up to date?** When `git merge-base --is-ancestor <target> HEAD` succeeds,
   the branch already contains its base. Say so and stop — there is nothing to
   rebase and no impact to judge.

## 2. Scout

In Claude Code, launch this plugin's `ship:rebase-scout` agent with the Task
tool. Pass the base, the target ref, and whether the working-tree change may be
stashed and restored. In OpenCode, launch `ship/rebase-scout` with the `subagent`
tool, inheriting its configured model rather than choosing a Claude model alias.
In Codex, or when the agent cannot be launched, read
`../../agents/rebase-scout.md` relative to this file and carry out its procedure
directly.

It returns a report whose first line is `Impact: none | small | large`.

## 3. Act on the report

- **none / small, rebased.** Read its conflicts and adaptations, and check its
  `State` line: the branch is rebased, any adaptations sit uncommitted in the
  working tree, and no stash is left behind. Continue to **Verify**.
- **large, not rebased.** The repository is as it was. Weigh the scout's
  **Decisions for the caller** against the upstream commits it names, reading
  them yourself where its summary is not enough:
  - When the right adaptation follows from the code — a contract to follow, the
    new places the change must also cover — make it.
  - When it changes what the branch is for — upstream already does what the
    branch adds, or took the area in a direction the branch contradicts — stop
    and put the scout's findings and your recommendation to the user. That
    choice is theirs, including dropping the branch.

  Then rebase following the scout's **Rebase mechanics**, resolving conflicts in
  the direction chosen, and make the adaptations. Leave the ones outside a
  conflict resolution uncommitted, as the scout would. Continue to **Verify**.
- **large, stopped part-way.** Rebasing turned up more than the scout predicted.
  Read its `State` line:
  - **Rebase aborted, stash restored** — the repository is as it was; treat it
    as large, above.
  - **Branch rebased, stash conflicted or kept** — do not rerun the mechanics.
    Resolve the conflicted files it left, then `git reset` to unstage them; or,
    when the restore stopped on an untracked-file collision, recover only the
    content it lists as missing — never pop a stash it says was partly
    restored. Drop the stash only after checking its commit. Then make the
    adaptation as for large, above, and continue to **Verify**.

## 4. Verify

When the caller said it verifies next, skip step 1, and in step 2 review only
the conflict resolutions in rebased commits — the caller's working-tree review
covers the uncommitted adaptations.

1. Run every non-null `qualityGates` command from `config.md`'s **live project
   facts**, read from the current worktree — the base's new commits changed the
   code under the branch even when no conflict did. Fix failures and rerun until
   green; never leave the branch past a failing gate.
2. When a conflict was resolved by hand or an adaptation was made, review the
   result with the `review-fix-loop` skill bundled with this plugin —
   `ship:review-fix-loop` through the Skill tool in Claude Code,
   `$review-fix-loop` in Codex, or `../review-fix-loop/SKILL.md` relative to
   this file when neither can be invoked. Scope it to cover everything the
   rebase touched: the working tree for uncommitted adaptations, the diff
   against the target ref for conflict resolutions that landed in rebased
   commits, and both scopes when both exist; give "conflict resolutions and
   adaptations from a rebase onto `<base>`" as its focus. A critical or
   important finding the loop leaves open stops the rebase here: put it to the
   user.

## Finish

Report the base and target ref, how many upstream commits were integrated, the
impact level with the upstream changes that mattered, each conflict and how it
was resolved, each adaptation and whether it is still uncommitted, the gates
run, and the review outcome. For a large impact, include the decision made and
who made it.

Never push. A rebased branch that was already pushed needs
`git push --force-with-lease --force-if-includes`: say so when the branch has an
upstream, and leave it to the caller or the user.
