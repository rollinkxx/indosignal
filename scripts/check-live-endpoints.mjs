import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const curl = promisify(execFile);
const base = 'https://indodax.com';
const endpoints = ['/api/server_time', '/api/summaries', '/api/ticker_all', '/api/pairs'];
for (const path of endpoints) {
  const { stdout } = await curl('curl', ['--fail-with-body', '--silent', '--show-error', '--location', '--user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36', '--header', 'Accept: application/json', '--header', 'Accept-Language: id-ID,id;q=0.9', '--header', 'Referer: https://indodax.com/', base + path]);
  const body = JSON.parse(stdout);
  if (body === null || body === undefined) throw new Error(`${path} returned empty JSON`);
  console.log(`${path}: live JSON`);
}
