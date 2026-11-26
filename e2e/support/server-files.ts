import { tmpdir } from 'node:os'
import path from 'node:path'

/** Where the e2e server leaves its log and database address for the tests to read. */
export const e2eServerFiles = {
  log: path.join(tmpdir(), 'nightjar-e2e-server.log'),
  databaseUrl: path.join(tmpdir(), 'nightjar-e2e-database-url.txt'),
}
