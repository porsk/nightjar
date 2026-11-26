import { createServer } from 'node:net'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** Postgres 19 on a fixed host port, so the container can be stopped and started again at the same address. */
export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  const hostPort = await freePort()
  return new PostgreSqlContainer('postgres:19')
    .withExposedPorts({ container: 5432, host: hostPort })
    .start()
}
