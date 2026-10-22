// Runs the API server and restarts it when a file in server/ changes.
// Node's own --watch-path also restarts on writes under node_modules (Vite
// writes its cache there while you browse), which dropped requests mid-flight.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';

const args = ['--env-file-if-exists=.env', 'server/index.mjs'];
let child = null;
let timer = null;

function start() {
  child = spawn(process.execPath, args, { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code !== 0) console.error(`API server exited (${code ?? signal}). Waiting for a change in server/.`);
  });
}

function restart(file) {
  clearTimeout(timer);
  // Editors often write a file in several steps; wait for them to finish.
  timer = setTimeout(() => {
    console.log(`Restarting API server (${file} changed)`);
    if (child && child.exitCode === null) {
      child.once('exit', start);
      child.kill('SIGTERM');
    } else start();
  }, 200);
}

watch('server', { recursive: true }, (_event, file) => {
  if (file && /\.(mjs|js|json)$/.test(file)) restart(file);
});
watch('.', (_event, file) => {
  if (file === '.env') restart('.env');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child?.kill('SIGTERM');
    process.exit(0);
  });
}
start();
