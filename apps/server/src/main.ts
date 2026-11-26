import { buildApp } from './app.ts'

const port = Number(process.env['PORT'] ?? 3000)
const webDir = process.env['NIGHTJAR_WEB_DIR']

await buildApp({ webDir }).listen({ port, host: '0.0.0.0' })
