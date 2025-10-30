import { execSync, spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'

function sh(cmd: string, env: Record<string, string | undefined> = {}) {
  const res = spawnSync('bash', ['-lc', cmd], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { code: res.status ?? 1, out: res.stdout ?? '', err: res.stderr ?? '' }
}

describe('Make log-driven diagnostics', () => {
  it('cdp-check prints section header and respects DRY-RUN', () => {
    const { code, out } = sh('make cdp-check', { D3K_LOG_DRY_RUN: '1' })
    expect(code).toBe(0)
    expect(out).toContain('=== CDP Reachability Check ===')
    expect(out).toContain('RUN: node scripts/check-cdp.mjs')
    expect(out).toContain('Mode: DRY-RUN')
  })

  it('dev-up delegates to cdp-check (log presence)', { timeout: 20000 }, () => {
    const { code, out } = sh('make dev-up', { D3K_LOG_DRY_RUN: '1' })
    expect(code).toBe(0)
    expect(out).toContain('Step 1: Starting Docker containers...')
    expect(out).toContain('Step 2: Waiting for Next.js to be ready...')
    expect(out).toContain('Step 3: Launching Chrome with CDP...')
    expect(out).toContain('Step 4: Running cdp-check diagnostics')
  })
})
