import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { asset, root } from '../src/content.ts'

const run = promisify(execFile)

test('prebuilt Git package never opts into npm dependency preparation', async () => {
  const manifest = JSON.parse(await readFile(asset('package.json'), 'utf8')) as {
    workspaces?: unknown
    scripts: Record<string, string>
  }
  assert.equal(manifest.workspaces, undefined)
  for (const trigger of ['build', 'prepare', 'prepack', 'preinstall', 'install', 'postinstall']) {
    assert.equal(manifest.scripts[trigger], undefined, `${trigger} opts Git installs into unnecessary npm preparation`)
  }
  assert.equal(manifest.scripts['build:tui'], 'node packages/opencode/scripts/build-tui.mjs')
  await readFile(asset('packages/opencode/dist/tui.js'), 'utf8')
})

test('packed node_modules TUI loads and renders with the host runtime, without a source JSX preload', async () => {
  const directory = await mkdtemp(join(process.env.OPENCODE_TEST_TMP ?? tmpdir(), 'lix42-tui-package-'))
  const packed = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root })
  const [{ filename }] = JSON.parse(packed.stdout) as { filename: string }[]
  const installed = join(directory, 'node_modules', 'opencode-lix42')
  await mkdir(installed, { recursive: true })
  await run('tar', ['-xzf', join(directory, filename), '--strip-components=1', '-C', installed])
  // Only dependencies are shared with the test runner. Every plugin source,
  // asset, and entrypoint comes from the actual packed artifact in node_modules.
  await symlink(asset('node_modules'), join(installed, 'node_modules'), 'dir')
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')) as { exports: { './tui': string } }
  assert.equal(manifest.exports['./tui'], './packages/opencode/dist/tui.js')
  const entry = join(installed, manifest.exports['./tui'])
  assert.doesNotMatch(await readFile(entry, 'utf8'), /from\s+['"]react(?:\/|['"])/)

  // A separate process is essential: the normal UI suite deliberately preloads
  // the source JSX compiler, which skips node_modules in the real OpenCode host.
  const script = `
    import { pathToFileURL } from 'node:url';
    await import('@opentui/solid/runtime-plugin-support');
    const plugin = (await import(pathToFileURL(${JSON.stringify(entry)}).href)).default;
    if (plugin.id !== 'lix42.tui') throw new Error('Wrong packaged entrypoint');
    const { testRender } = await import('@opentui/solid');
    let band;
    const state = {
      prs: [{ ref: { url: 'https://github.com/acme/app/pull/42', number: 42 }, snapshot: null, error: null }],
      selected: null, methods: {}, busy: null, notice: null, agent: true,
    };
    const rpc = { status: async () => ({ enabled: true }), state: async () => state, events: { on: () => () => {} } };
    const stop = plugin.setup({
      options: {}, client: { rpc: () => rpc },
      data: { session: { get: () => ({ location: { directory: '/project' } }) } },
      theme: { text: { muted: '#aaaaaa', base: '#ffffff', accent: '#88aaff' } },
      keymap: { layer: () => {} },
      ui: { slot: claim => { if (claim.append === 'session.composer.top') band = claim.render; return () => {}; } },
    });
    if (!band) throw new Error('Composer slot not registered');
    const rendered = await testRender(() => band({ sessionID: 'ses_packaged' }), { width: 80, height: 8 });
    try {
      await rendered.waitForFrame(frame => frame.includes('#42 loading'));
    } finally {
      rendered.renderer.destroy();
      await stop?.();
    }
    console.log('PACKAGED_TUI_OK');
  `
  const env = { ...process.env }
  delete env.BUN_OPTIONS
  delete env.NODE_OPTIONS
  const result = await run(process.execPath, ['--conditions=browser', '-e', script], { cwd: root, env, timeout: 60_000 })
  assert.match(result.stdout, /PACKAGED_TUI_OK/)
})
