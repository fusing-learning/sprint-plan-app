import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSprintflowServer } from './app';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';
const dataDir = path.resolve(process.env.SPRINTFLOW_DATA_DIR ?? 'data');
const distDir = path.resolve('dist');
const apiOnly = process.argv.includes('--api-only');

if (!apiOnly && !fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('No build found in dist/. Run `npm start` (builds, then serves) or `npm run build` first.');
  process.exit(1);
}

const { server, close } = await createSprintflowServer({ dataDir, distDir: apiOnly ? undefined : distDir });

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set another one with PORT=4001 npm start.` : e);
  process.exit(1);
});

server.listen(port, host, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
  const hostname = os.hostname();
  console.log(`\nSprintFlow shared workspace ${apiOnly ? '(API only) ' : ''}is running.\n`);
  console.log(`  On this computer:  http://localhost:${port}`);
  if (host === '0.0.0.0') {
    for (const url of lan) console.log(`  For colleagues:    ${url}`);
    if (hostname.endsWith('.local')) console.log(`                     http://${hostname}:${port}`);
  }
  console.log(`\n  Data file: ${path.join(dataDir, 'workspace.json')} (daily copies in backups/)`);
  console.log('  Keep this window open and this computer awake. Press Ctrl+C to stop.\n');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void close().then(() => process.exit(0));
  });
}
