import { Rpc } from '@opencode/plugin/rpc'
import type { Check, MergeMethod, Notice, TrackedPr } from '../../../plugins/pr-panel/types/index.d.ts'

export type FixTarget = { url: string; itemID: string } & (
  { kind: 'thread' } | { kind: 'check'; headSha: string }
)

// Check names alone are not unique across workflows or runs. gh's normalized
// snapshot has no native check ID, so preserve all available identity fields.
export const checkID = (check: Check) => JSON.stringify([check.name, check.workflow, check.url, check.runId])

const fixTarget = {
  oneOf: [
    {
      type: 'object', properties: { url: { type: 'string' }, kind: { const: 'thread' }, itemID: { type: 'string' } },
      required: ['url', 'kind', 'itemID'], additionalProperties: false,
    },
    {
      type: 'object', properties: { url: { type: 'string' }, kind: { const: 'check' }, itemID: { type: 'string' }, headSha: { type: 'string' } },
      required: ['url', 'kind', 'itemID', 'headSha'], additionalProperties: false,
    },
  ],
}

export type PanelState = {
  prs: TrackedPr[]
  selected: string | null
  methods: Record<string, MergeMethod>
  busy: string | null
  notice: Notice | null
  agent: boolean
}

export const initialState = (): PanelState => ({ prs: [], selected: null, methods: {}, busy: null, notice: null, agent: true })

const input = (properties: Record<string, object>, required: string[] = []) => ({
  type: 'object' as const, properties: { sessionID: { type: 'string', minLength: 1 }, ...properties },
  required: ['sessionID', ...required], additionalProperties: false,
})
const object = { type: 'object', additionalProperties: true }

export const PanelRpc = Rpc.define({
  id: 'lix42.pr-panel',
  methods: {
    status: { input: { type: 'object', properties: {}, additionalProperties: false }, output: object },
    state: { input: input({}), output: object },
    command: { input: input({ args: { type: 'string' }, url: { type: 'string' } }, ['args']), output: object },
    select: { input: input({ url: { type: 'string' } }, ['url']), output: object },
    refresh: { input: input({ url: { type: 'string' } }, ['url']), output: object },
    method: { input: input({ url: { type: 'string' }, method: { enum: ['squash', 'merge', 'rebase'] } }, ['url', 'method']), output: object },
    prepare: { input: input({ url: { type: 'string' }, method: { enum: ['squash', 'merge', 'rebase', null] }, action: { enum: ['auto-enable', 'auto-disable', 'merge', 'bypass', 'ready', 'rerun'] } }, ['url', 'action']), output: object },
    action: { input: input({ token: { type: 'string' } }, ['token']), output: object },
    fix: { input: input({ target: fixTarget }, ['target']), output: object },
  },
  events: {
    updated: { schema: input({ state: object }, ['state']) },
    notice: { schema: input({ text: { type: 'string' }, title: { type: 'string' }, important: { type: 'boolean' } }, ['text', 'title', 'important']) },
  },
})
