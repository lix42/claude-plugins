export const commands = [
  ['tasks-setup', 'tasks', 'task-tracking', 'Set up the tasks: interview, agree on design, and get approval before writing.'],
  ['tasks-next', 'tasks', 'task-tracking', 'Find the next unblocked tasks.'],
  ['tasks-update', 'tasks', 'task-tracking', 'Update the task plan and its dependencies.'],
  ['tasks-done', 'tasks', 'task-tracking', 'Mark the specified task done and show what it unblocks.'],
  ['tasks-group', 'tasks', 'task-tracking', 'Group an oversized flat plan into structural epics.'],
  ['tasks-migrate', 'tasks', 'task-tracking', 'Migrate the old checkbox task plan to frontmatter task files.'],
  ['start-task', 'tasks', 'start-task', 'Start the chosen task in its own worktree; get agreement on the plan before implementation.'],
  ['ship', 'ship', 'ship', 'Ship the current change end to end. Never merge a GitHub PR.'],
  ['ship-config', 'ship', 'ship', 'Refresh ship configuration only; do not ship any changes.'],
  ['drive-pr', 'ship', 'drive-pr', 'Drive the specified or current PR to green. Never merge it.'],
  ['rebase', 'ship', 'rebase', 'Rebase onto the specified or detected base. Never push.'],
  ['review-changes', 'ship', 'review-changes', 'Review the local change and report findings only; do not edit or publish.'],
] as const

export function commandText(instruction: string, args: string) {
  return `${instruction}\n\nUser request and command arguments (honor supported flags and the requested scope/change):\n${args}`
}
