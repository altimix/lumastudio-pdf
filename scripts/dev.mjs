import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
const server = await createServer();
await server.listen();
server.printUrls();
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0] } });
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => child.kill());
