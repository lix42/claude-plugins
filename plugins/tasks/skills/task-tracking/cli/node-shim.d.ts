// The slice of Node's API the CLI uses, so `tsc` needs no @types/node install.

declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void
  export function mkdtempSync(prefix: string): string
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void
  export function cpSync(from: string, to: string, opts?: { recursive?: boolean }): void
  export function readdirSync(path: string): string[]
  export function renameSync(from: string, to: string): void
  export function statSync(path: string): { isDirectory(): boolean }
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
  export function dirname(path: string): string
  export function relative(from: string, to: string): string
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}

declare module 'node:util' {
  type OptionSpec = { type: 'string' | 'boolean'; short?: string }
  export function parseArgs(config: {
    args: string[]
    allowPositionals?: boolean
    options: Record<string, OptionSpec>
  }): { values: Record<string, string | boolean | undefined>; positionals: string[] }
}

declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: string[],
    opts: { cwd?: string; encoding: 'utf8'; input?: string; stdio?: unknown },
  ): string
}

declare module 'node:test' {
  export function describe(name: string, fn: () => void): void
  export function test(name: string, fn: () => void | Promise<void>): void
}

declare module 'node:assert/strict' {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
    ok(value: unknown, message?: string): void
    match(value: string, re: RegExp, message?: string): void
    doesNotMatch(value: string, re: RegExp, message?: string): void
    throws(fn: () => unknown, expected?: RegExp): void
  }
  export default assert
}

declare const process: {
  argv: string[]
  cwd(): string
  exitCode: number | undefined
  stdout: { write(s: string): void }
  stderr: { write(s: string): void }
}

interface ImportMeta {
  url: string
  dirname: string
}
