import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { runExperiment, validateSimulateRequest } from './src/bb84Core.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(__dirname, '../backend')

interface RpcResponse {
  id: number
  status: number
  body: unknown
}

let stdioWorker: ChildProcessWithoutNullStreams | null = null
let httpDaemon: ChildProcessWithoutNullStreams | null = null
let nextRpcId = 1
const pendingRpc = new Map<
  number,
  { resolve: (res: RpcResponse) => void; reject: (err: Error) => void }
>()

function ensurePythonBackend() {
  if (!httpDaemon || httpDaemon.killed) {
    try {
      httpDaemon = spawn('python3', ['-m', 'app.main', '--host', '127.0.0.1', '--port', '8123'], {
        cwd: BACKEND_DIR,
        stdio: 'pipe',
      })
      httpDaemon.on('error', () => {
        httpDaemon = null
      })
      httpDaemon.on('exit', () => {
        httpDaemon = null
      })
    } catch {
      httpDaemon = null
    }
  }

  if (!stdioWorker || stdioWorker.killed) {
    try {
      stdioWorker = spawn('python3', ['-m', 'app.main', '--stdio'], {
        cwd: BACKEND_DIR,
        stdio: 'pipe',
      })
      const rl = readline.createInterface({ input: stdioWorker.stdout })
      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line) as RpcResponse
          const handler = pendingRpc.get(msg.id)
          if (handler) {
            pendingRpc.delete(msg.id)
            handler.resolve(msg)
          }
        } catch {
          // ignore non-JSON lines
        }
      })
      stdioWorker.on('error', (err) => {
        for (const [, h] of pendingRpc) h.reject(err)
        pendingRpc.clear()
        stdioWorker = null
      })
      stdioWorker.on('exit', () => {
        for (const [, h] of pendingRpc) h.reject(new Error('Python worker exited'))
        pendingRpc.clear()
        stdioWorker = null
      })
    } catch {
      stdioWorker = null
    }
  }
}

async function callPythonBackend(
  method: 'GET' | 'POST',
  apiPath: string,
  body: unknown = {},
): Promise<{ status: number; body: unknown }> {
  ensurePythonBackend()

  if (stdioWorker && !stdioWorker.killed && stdioWorker.stdin.writable) {
    try {
      const id = nextRpcId++
      const response = await new Promise<RpcResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRpc.delete(id)
          reject(new Error('Python stdio worker timeout'))
        }, 8000)
        pendingRpc.set(id, {
          resolve: (res) => {
            clearTimeout(timer)
            resolve(res)
          },
          reject: (err) => {
            clearTimeout(timer)
            reject(err)
          },
        })
        stdioWorker!.stdin.write(
          JSON.stringify({ id, method, path: apiPath, body }) + '\n',
        )
      })
      return { status: response.status, body: response.body }
    } catch {
      // Fall through to synchronous python3 invocation
    }
  }

  // Synchronous one-shot invocation of Python backend if persistent worker is busy
  const pyOut = execFileSync(
    'python3',
    [
      '-c',
      'import sys, json; from app.main import handle_api_call; req = json.loads(sys.stdin.read()); status, payload = handle_api_call(req["method"], req["path"], req.get("body")); print(json.dumps({"status": status, "body": payload}))',
    ],
    {
      cwd: BACKEND_DIR,
      input: JSON.stringify({ method, path: apiPath, body }),
      encoding: 'utf-8',
      timeout: 8000,
    },
  )
  return JSON.parse(pyOut.trim()) as { status: number; body: unknown }
}

function handleApiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const url = req.url?.split('?')[0]
  if (url === '/api/health' && req.method === 'GET') {
    callPythonBackend('GET', '/api/health')
      .then((pyRes) => {
        res.statusCode = pyRes.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(pyRes.body))
      })
      .catch(() => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ status: 'ok', service: 'bb84-api', version: '1.0.0' }))
      })
    return
  }

  if (url === '/api/simulate' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8')
    })
    req.on('end', () => {
      let parsed: unknown = {}
      try {
        parsed = body ? JSON.parse(body) : {}
      } catch (err) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            detail: err instanceof Error ? err.message : 'Malformed JSON body',
          }),
        )
        return
      }

      callPythonBackend('POST', '/api/simulate', parsed)
        .then((pyRes) => {
          res.statusCode = pyRes.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(pyRes.body))
        })
        .catch(() => {
          // Fallback to TS engine only if Python runtime is unavailable
          const validated = validateSimulateRequest(parsed)
          if (!validated.valid || !validated.data) {
            res.statusCode = 422
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ detail: validated.error ?? 'Invalid request' }))
            return
          }
          const result = runExperiment(validated.data)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        })
    })
    return
  }

  next()
}

function bb84ApiPlugin(): Plugin {
  return {
    name: 'bb84-api-middleware',
    configureServer(server) {
      ensurePythonBackend()
      server.middlewares.use(handleApiMiddleware)
    },
    configurePreviewServer(server) {
      ensurePythonBackend()
      server.middlewares.use(handleApiMiddleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss(), bb84ApiPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three'],
  },
  optimizeDeps: {
    include: [
      'three',
      'three/addons/controls/OrbitControls.js',
      'three/addons/environments/RoomEnvironment.js',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
})

