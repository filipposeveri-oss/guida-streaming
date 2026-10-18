#!/usr/bin/env node
// Serve il frontend e data.json, e rilancia la sincronizzazione ogni notte.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import path from 'node:path';
import { config } from './config.js';
import { runSync } from './sync.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

let syncing = false, lastSync = null, lastError = null;

async function doSync(reason) {
  if (syncing) return;
  syncing = true;
  console.log(`Sincronizzazione avviata (${reason})`);
  try { await runSync(); lastSync = new Date().toISOString(); lastError = null; }
  catch (err) { lastError = err.message; console.error('Sincronizzazione fallita:', err.message); }
  finally { syncing = false; }
}

function scheduleNightly() {
  const next = new Date();
  next.setHours(config.syncHour, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  const ms = next - Date.now();
  console.log(`Prossima sincronizzazione: ${next.toLocaleString('it-IT')}`);
  setTimeout(async () => { await doSync('notturna'); scheduleNightly(); }, ms);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, syncing, lastSync, lastError }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(config.publicDir, path.normalize(rel));
  if (!file.startsWith(config.publicDir)) { res.writeHead(403); return res.end(); }

  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error();
    const ext = path.extname(file);
    const headers = {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'cache-control': ext === '.json' ? 'public, max-age=900' : 'public, max-age=3600',
      'last-modified': st.mtime.toUTCString(),
      'access-control-allow-origin': '*',
      vary: 'accept-encoding',
    };
    if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(st.mtime.toUTCString())) {
      res.writeHead(304, headers); return res.end();
    }
    const body = await readFile(file);
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /json|html|javascript|css|svg/.test(headers['content-type']);
    if (gzip) headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    if (gzip) Readable.from([body]).pipe(createGzip()).pipe(res); else res.end(body);
  } catch {
    if (rel === '/data.json') {
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '60' });
      return res.end(JSON.stringify({ error: syncing ? 'Primo aggiornamento in corso' : 'Dati non ancora disponibili' }));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Non trovato');
  }
});

server.listen(config.port, async () => {
  console.log(`Guida Streaming in ascolto su http://localhost:${config.port}`);
  const hasData = await stat(path.join(config.publicDir, 'data.json')).then(() => true, () => false);
  if (config.syncOnStart === 'always' || (config.syncOnStart === 'missing' && !hasData)) doSync('avvio');
  scheduleNightly();
});
