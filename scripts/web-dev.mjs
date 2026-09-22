import { createServer } from 'vite';
import { createApiServer } from '../server/dev-api.mjs';
const api = createApiServer();
await new Promise((resolve,reject)=>{ api.once('error',reject); api.listen(5194,'127.0.0.1',resolve); });
const vite = await createServer();
await vite.listen(); vite.printUrls();
const close = async () => { api.close(); await vite.close(); process.exit(0); };
process.on('SIGINT',close); process.on('SIGTERM',close);
