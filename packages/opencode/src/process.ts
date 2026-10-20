import { execFile } from 'node:child_process'

/** No shell interpolation; all gh calls use argv and the owning session's cwd. */
export function runner(directory: string, signal: AbortSignal) {
  return (argv: readonly string[], timeout: number): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
    new Promise(resolve => {
      execFile(argv[0], [...argv.slice(1)], { cwd: directory, timeout, signal, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr: stderr || (error?.message ?? '') })
      })
    })
}
