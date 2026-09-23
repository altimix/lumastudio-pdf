import { createServer, preview } from 'vite';

// Run the built app for ordinary workflows and a separate source server only
// for tests that import font/PDF helpers. One process owns both listeners so
// Playwright can stop them together on Windows as well as macOS.
const source = await createServer({ server: { host: '127.0.0.1', port: 5195, strictPort: true } });
let production;
try {
  await source.listen();
  production = await preview({ preview: { host: '127.0.0.1', port: 5193, strictPort: true } });
  production.printUrls();
  source.printUrls();
} catch (error) {
  await source.close();
  throw error;
}

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await Promise.allSettled([production.close(), source.close()]);
  process.exit(0);
};
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
