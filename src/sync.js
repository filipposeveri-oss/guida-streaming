#!/usr/bin/env node
// Scarica i cataloghi streaming italiani da TMDB (dati JustWatch) e i voti IMDb / Rotten Tomatoes da OMDb.
// Produce public/data.json, letto dal frontend. Mantiene in data/ratings.json una cache dei voti
// per restare nel limite giornaliero di OMDb.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { CATS, catsFor } from './categories.js';

// Ordine di preferenza; i nomi vengono confrontati senza spazi, maiuscole e simboli ("Now TV" = "NOW")
const PREFERRED = ['netflix', 'amazonprimevideo', 'disneyplus', 'appletv', 'appletvplus', 'now', 'nowtv',
  'raiplay', 'paramountplus', 'mediasetinfinity', 'skygo', 'timvision', 'discoveryplus', 'discovery'];
const norm = (n) => n.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
const prefIndex = (p) => { const i = PREFERRED.indexOf(norm(p.name)); return i < 0 ? Infinity : i; };
const EXCLUDE = /channel|with ads|standard|kids|amazon video|google play|apple tv store|rakuten|chili|microsoft|youtube|justwatch|pluto|plex/i;
const DAY = 864e5;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, opts = {}, tries = 4) {
  for (let i = 1; ; i++) {
    let res;
    try { res = await fetch(url, opts); } catch (err) { if (i >= tries) throw err; await sleep(500 * 2 ** i); continue; }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && i < tries) {
      const wait = (+res.headers.get('retry-after') || 2 ** i) * 1000;
      await sleep(wait); continue;
    }
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} su ${url.toString().split('?')[0]}: ${body.slice(0, 160)}`);
    err.status = res.status; throw err;
  }
}

function tmdb(p, params = {}) {
  const u = new URL(config.tmdbBase.replace(/\/$/, '') + p);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (config.tmdbToken.length > 40) headers.authorization = 'Bearer ' + config.tmdbToken;
  else u.searchParams.set('api_key', config.tmdbToken);
  return fetchJSON(u, { headers });
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJSONAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

// ---------- piattaforme ----------
async function getProviders() {
  const q = { watch_region: config.region, language: config.language };
  const [m, t] = await Promise.all([tmdb('/watch/providers/movie', q), tmdb('/watch/providers/tv', q)]);
  const map = new Map();
  for (const p of [...m.results, ...t.results]) {
    const prio = p.display_priorities?.[config.region] ?? p.display_priority ?? 999;
    const cur = map.get(p.provider_id);
    if (!cur || prio < cur.prio) map.set(p.provider_id, { id: p.provider_id, name: p.provider_name, logo: p.logo_path, prio });
  }
  const all = [...map.values()].sort((a, b) => a.prio - b.prio);
  if (config.providers.length) {
    return config.providers.map((id) => map.get(id)).filter(Boolean);
  }
  const clean = all.filter((p) => !EXCLUDE.test(p.name));
  const pref = clean.filter((p) => prefIndex(p) < Infinity).sort((a, b) => prefIndex(a) - prefIndex(b));
  const rest = clean.filter((p) => prefIndex(p) === Infinity);
  return [...pref, ...rest].slice(0, config.providerLimit);
}

// ---------- catalogo ----------
async function getCatalog(providers) {
  const today = new Date().toISOString().slice(0, 10);
  const jobs = [];
  for (const p of providers) for (const type of ['movie', 'tv']) {
    const base = { watch_region: config.region, with_watch_providers: p.id,
      with_watch_monetization_types: 'flatrate|free|ads', language: config.language, include_adult: 'false' };
    for (let page = 1; page <= config.pagesPopular; page++)
      jobs.push({ p, type, list: 'popular', params: { ...base, page, sort_by: 'popularity.desc' } });
    const dateField = type === 'movie' ? 'primary_release_date' : 'first_air_date';
    for (let page = 1; page <= config.pagesRecent; page++)
      jobs.push({ p, type, list: 'recent', params: { ...base, page, sort_by: `${dateField}.desc`,
        [`${dateField}.lte`]: today, 'vote_count.gte': 10 } });
  }
  log(`Catalogo: ${jobs.length} richieste a TMDB per ${providers.length} piattaforme`);

  const items = new Map();
  let failed = 0;
  await pool(jobs, 8, async (j) => {
    let d;
    try { d = await tmdb('/discover/' + j.type, j.params); }
    catch (err) { if (err.status === 401) throw err; failed++; return; }
    d.results.forEach((r, i) => {
      const key = `${j.type}:${r.id}`;
      let it = items.get(key);
      if (!it) {
        it = { key, type: j.type, id: r.id, title: r.title || r.name, orig: r.original_title || r.original_name,
          date: r.release_date || r.first_air_date || '', poster: r.poster_path || null,
          overview: (r.overview || '').slice(0, 600), cats: catsFor(j.type, r.genre_ids),
          providers: new Set(), popularity: r.popularity || 0, tmdbVote: r.vote_average || null, rank: Infinity };
        items.set(key, it);
      }
      it.providers.add(j.p.id);
      if (j.list === 'popular') it.rank = Math.min(it.rank, (j.params.page - 1) * 20 + i);
      it.popularity = Math.max(it.popularity, r.popularity || 0);
    });
  });
  if (failed) log(`Attenzione: ${failed} richieste di catalogo fallite, i titoli relativi mancano in questo giro`);
  return items;
}

// ---------- voti ----------
async function enrichRatings(items, cache) {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  if (cache._usage?.date !== todayStr) cache._usage = { date: todayStr, omdb: 0 };
  const ttl = config.ratingTtlDays * DAY;

  // Ordine: prima i più popolari, così il budget OMDb va ai titoli che contano di più.
  const ordered = [...items.values()].sort((a, b) => a.rank - b.rank || b.popularity - a.popularity);

  // 1) ID IMDb via TMDB (nessun limite pratico, cache permanente)
  const needExt = ordered.filter((it) => {
    const c = cache[it.key];
    return !c || (c.imdbId === null && now - (c.extAt || 0) > ttl);
  });
  log(`ID IMDb da cercare: ${needExt.length}`);
  await pool(needExt, 8, async (it) => {
    try {
      const ext = await tmdb(`/${it.type}/${it.id}/external_ids`);
      cache[it.key] = { ...(cache[it.key] || {}), imdbId: ext.imdb_id || null, extAt: now };
    } catch { /* riprova al prossimo giro */ }
  });

  // 2) Voti via OMDb, entro il budget giornaliero
  if (!config.omdbKey) { log('OMDB_KEY assente: salto i voti IMDb e Rotten Tomatoes'); return { fetched: 0, pending: 0 }; }
  const needVotes = ordered.filter((it) => {
    const c = cache[it.key];
    return c?.imdbId && (!c.ratedAt || now - c.ratedAt > ttl);
  });
  const budget = Math.max(0, config.omdbDailyBudget - cache._usage.omdb);
  const batch = needVotes.slice(0, budget);
  log(`Voti da aggiornare: ${needVotes.length}, budget OMDb oggi: ${budget}`);

  let stop = null, fetched = 0;
  await pool(batch, 4, async (it) => {
    if (stop) return;
    const c = cache[it.key];
    const u = new URL(config.omdbBase);
    u.searchParams.set('i', c.imdbId); u.searchParams.set('apikey', config.omdbKey);
    let d;
    try { d = await fetchJSON(u); } catch (err) {
      // OMDb risponde 401 sia per chiave errata sia per limite raggiunto
      if (err.status === 401) stop = /limit/i.test(err.message) ? 'Limite giornaliero OMDb raggiunto' : 'La chiave OMDb non è valida o non è attiva';
      return;
    }
    cache._usage.omdb++;
    if (d.Response === 'False') {
      if (/limit/i.test(d.Error)) { stop = 'Limite giornaliero OMDb raggiunto'; return; }
      if (/invalid api key/i.test(d.Error)) { stop = 'La chiave OMDb non è valida'; return; }
      Object.assign(c, { imdb: null, votes: null, rt: null, meta: null, ratedAt: now });
      fetched++; return;
    }
    const rt = (d.Ratings || []).find((x) => x.Source === 'Rotten Tomatoes');
    Object.assign(c, {
      imdb: parseFloat(d.imdbRating) || null,
      votes: d.imdbVotes && d.imdbVotes !== 'N/A' ? +d.imdbVotes.replace(/,/g, '') : null,
      rt: rt ? parseInt(rt.Value, 10) : null,
      meta: d.Metascore && d.Metascore !== 'N/A' ? +d.Metascore : null,
      ratedAt: now,
    });
    fetched++;
  });
  if (stop) {
    log('OMDb: ' + stop);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=OMDb::${stop}`);
    // Niente altre chiamate oggi: evita di sprecare richieste se il server riparte
    if (/limite/i.test(stop)) cache._usage.omdb = Math.max(cache._usage.omdb, config.omdbDailyBudget);
  }
  return { fetched, pending: needVotes.length - fetched, stop };
}

// ---------- esecuzione ----------
export async function runSync() {
  if (!config.tmdbToken) throw new Error('Manca TMDB_TOKEN (API key v3 o token v4 di TMDB)');
  const t0 = Date.now();
  const ratingsFile = path.join(config.dataDir, 'ratings.json');
  const cache = await readJSON(ratingsFile, {});

  const providers = await getProviders();
  log('Piattaforme:', providers.map((p) => `${p.name} (${p.id})`).join(', '));
  const items = await getCatalog(providers);
  log(`Titoli unici: ${items.size}`);

  const r = await enrichRatings(items, cache);
  await writeJSONAtomic(ratingsFile, cache);

  const out = {
    generatedAt: new Date().toISOString(),
    region: config.region,
    ratings: { pending: r.pending, note: r.stop || null },
    providers: providers.map(({ id, name, logo }) => ({ id, name, logo })),
    categories: CATS.map(({ id, name }) => ({ id, name })),
    // Chiavi brevi per contenere il peso del file
    items: [...items.values()].sort((a, b) => a.rank - b.rank || b.popularity - a.popularity).map((it) => {
      const c = cache[it.key] || {};
      return {
        k: it.key, ty: it.type, id: it.id, t: it.title, o: it.orig !== it.title ? it.orig : undefined,
        d: it.date || undefined, p: it.poster || undefined, ov: it.overview || undefined,
        c: it.cats, pr: [...it.providers], po: Math.round(it.popularity * 10) / 10,
        r: Number.isFinite(it.rank) ? it.rank : undefined,
        ii: c.imdbId || undefined, im: c.imdb ?? undefined, iv: c.votes ?? undefined,
        rt: c.rt ?? undefined, mc: c.meta ?? undefined,
        nr: c.ratedAt && c.imdb == null && c.rt == null ? 1 : undefined, // controllato, nessun voto disponibile
      };
    }),
  };
  const outFile = path.join(config.publicDir, 'data.json');
  await writeJSONAtomic(outFile, out);
  const withVotes = out.items.filter((x) => x.im != null).length;
  log(`Fatto in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${out.items.length} titoli, ${withVotes} con voto IMDb, ` +
      `${r.fetched} voti scaricati ora, ${r.pending} in attesa`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSync().catch((err) => {
    console.error('Sincronizzazione fallita:', err.message);
    // Su GitHub Actions l'errore compare anche nel riepilogo del run
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Sincronizzazione fallita::${err.message.replace(/\r?\n/g, ' ')}`);
    process.exit(1);
  });
}
