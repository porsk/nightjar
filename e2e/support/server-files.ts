import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = process.env['NIGHTJAR_E2E_DIR'] ?? tmpdir()

/** Where the e2e server leaves its log and database address for the tests to read. */
export const e2eServerFiles = {
  log: path.join(dir, 'nightjar-e2e-server.log'),
  databaseUrl: path.join(dir, 'nightjar-e2e-database-url.txt'),
  dataDir: path.join(dir, 'data'),
}
