import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carica .env se presente (nessuna dipendenza esterna). Le variabili già definite vincono.
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

const e = process.env;
const int = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(+v) ? +v : d);

export const config = {
  tmdbToken: (e.TMDB_TOKEN || '').trim(),
  omdbKey: (e.OMDB_KEY || '').trim(),
  tmdbBase: e.TMDB_BASE || 'https://api.themoviedb.org/3',
  omdbBase: e.OMDB_BASE || 'https://www.omdbapi.com/',
  region: e.REGION || 'IT',
  language: e.LANGUAGE || 'it-IT',
  providers: (e.PROVIDERS || '').split(',').map((s) => +s.trim()).filter(Boolean),
  providerLimit: int(e.PROVIDER_LIMIT, 12),
  maxPages: int(e.MAX_PAGES, 500),        // pagine da 20 titoli per piattaforma e tipo; 500 = catalogo completo
  omdbDailyBudget: int(e.OMDB_DAILY_BUDGET, 900),
  ratingTtlDays: int(e.RATING_TTL_DAYS, 30),
  dataDir: path.resolve(ROOT, e.DATA_DIR || 'data'),
  publicDir: path.resolve(ROOT, e.PUBLIC_DIR || 'public'),
  port: int(e.PORT, 8080),
  syncHour: int(e.SYNC_HOUR, 4),           // ora locale del server per l'aggiornamento notturno
  syncOnStart: (e.SYNC_ON_START || 'missing') // always | missing | never
};
