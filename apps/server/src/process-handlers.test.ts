import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { captureLogs } from '../test/support/log-capture.ts'
import { createLogger } from './logger.ts'
import { createMetrics, startMetricsServer } from './metrics.ts'
import { describeError, installCrashHandlers, installShutdownHandlers } from './process-handlers.ts'

function setup() {
  const proc = new EventEmitter() as unknown as NodeJS.Process
  const capture = captureLogs()
  const logger = createLogger({ level: 'info', stream: capture.stream })
  return { proc, capture, logger, exit: vi.fn() }
}

describe('describeError', () => {
  it('keeps the name and code, never the message', () => {
    const error = Object.assign(new Error('ZQX-secret'), { code: 'EADDRINUSE' })
    expect(describeError(error)).toEqual({ name: 'Error', code: 'EADDRINUSE' })
    expect(describeError(new TypeError('x'))).toEqual({ name: 'TypeError' })
    expect(describeError('ZQX-secret')).toEqual({ name: 'NonError' })
  })

  it('is what the logger uses for the err key', () => {
    const { logger, capture } = setup()
    logger.error({ err: new Error('ZQX-secret') }, 'failed')
    expect(capture.lines()[0]).toMatchObject({ err: { name: 'Error' } })
    expect(capture.text()).not.toContain('ZQX-secret')
  })
})

describe('crash handlers', () => {
  it('log only the name and code of an uncaught exception or rejection, then exit 1', () => {
    const { proc, capture, logger, exit } = setup()
    installCrashHandlers(proc, { logger, exit })
    proc.emit('uncaughtException', new Error('ZQX-secret'))
    proc.emit('unhandledRejection', Object.assign(new Error('ZQX-secret'), { code: '23505' }))
    expect(exit).toHaveBeenCalledTimes(2)
    expect(exit).toHaveBeenCalledWith(1)
    expect(capture.lines()[1]).toMatchObject({ name: 'Error', code: '23505' })
    expect(capture.text()).not.toContain('ZQX-secret')
  })
})

describe('shutdown handlers', () => {
  it.each(['SIGTERM', 'SIGINT'])('close everything on %s, then exit 0', async (signal) => {
    const { proc, logger, exit } = setup()
    const close = vi.fn(() => Promise.resolve())
    installShutdownHandlers(proc, { logger, exit, close })
    proc.emit(signal)
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0)
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('exits 1 when closing fails', async () => {
    const { proc, logger, exit } = setup()
    installShutdownHandlers(proc, { logger, exit, close: () => Promise.reject(new Error('x')) })
    proc.emit('SIGTERM')
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1)
    })
  })
})

describe('metrics server startup', () => {
  it('rejects when the port is taken', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '0.0.0.0', resolve))
    const { port } = blocker.address() as { port: number }
    await expect(startMetricsServer(createMetrics(), port)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
    blocker.close()
  })
})
