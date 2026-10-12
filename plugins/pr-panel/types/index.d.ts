export type MergeMethod = 'squash' | 'merge' | 'rebase'

/** Where a PR lives, parsed from its URL. */
export type PrRef = {
  url: string
  host: string
  owner: string
  repo: string
  number: number
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'skipped'

export type Check = {
  name: string
  workflow: string | null
  state: CheckState
  url: string | null
  /** The Actions run behind the check, when it is one. */
  runId: string | null
}

export type Review = {
  author: string
  state: string
  body: string
}

export type Comment = {
  author: string
  body: string
  url: string
  createdAt: string
  isBot: boolean
}

export type ThreadReply = { author: string; body: string }

/** An unresolved review thread: its first comment, and the replies under it. */
export type Thread = {
  id: string
  path: string
  line: number | null
  author: string
  body: string
  url: string
  isOutdated: boolean
  replies: ThreadReply[]
}

/** What GitHub says the viewer may do on this PR. */
export type ViewerRights = {
  canMergeAsAdmin: boolean
  canEnableAutoMerge: boolean
}

/** The outcome of the last action, shown in the pane until the next one. */
export type Notice = { url: string; text: string; isError: boolean }

export type RepoSettings = {
  methods: MergeMethod[]
  isAutoMergeAllowed: boolean
}

export type PrSnapshot = {
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  mergeable: string
  mergeStateStatus: string
  reviewDecision: string
  headRefName: string
  baseRefName: string
  headSha: string
  autoMerge: { method: MergeMethod } | null
  checks: Check[]
  reviews: Review[]
  comments: Comment[]
  threads: Thread[]
  repo: RepoSettings
  viewer: ViewerRights
}

export type TrackedPr = {
  ref: PrRef
  snapshot: PrSnapshot | null
  error: string | null
  fetchedAt: number
  /** When it was first seen merged or closed; it leaves the band and the pane LINGER_MS later. */
  endedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'pr-panel': {
      prs: TrackedPr[]
      selected: string | null
      /** The merge method picked per PR URL; the repo's default otherwise. */
      methods: Record<string, MergeMethod>
      /** The action running now, shown in the pane. */
      busy: string | null
      /** The ids of the threads shown expanded. */
      expanded: string[]
      /** `<url>#<action>` awaiting its second press. */
      confirming: string | null
      notice: Notice | null
    }
  }
}
