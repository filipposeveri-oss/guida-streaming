# Guida Streaming

Cataloghi di film e serie disponibili in Italia sulle piattaforme di streaming, raggruppati per piattaforma e per categoria, con i voti di IMDb e Rotten Tomatoes.

Chi apre il sito non deve inserire chiavi: un processo notturno scarica i dati e li salva in `public/data.json`, che il frontend legge così com'è.

## Come funziona

1. **Piattaforme**: la lista delle piattaforme attive in Italia arriva da TMDB, con i dati di disponibilità forniti da JustWatch. Di default vengono scelte le 12 principali.
2. **Catalogo**: per ogni piattaforma e per ogni tipo (film o serie) vengono scaricate due liste:
   - le prime 5 pagine dei titoli più visti;
   - le prime 2 pagine delle uscite più recenti.

   Con 20 titoli per pagina, si ottengono circa 2.000–3.000 titoli unici.
3. **Categorie**: i generi TMDB di film e serie vengono riuniti in 16 categorie italiane, definite in `src/categories.js`.
4. **Voti**: per ogni titolo si ricava l'ID IMDb da TMDB e poi si interroga OMDb, che restituisce il voto IMDb, il Tomatometer di Rotten Tomatoes e il Metascore. Un voto già scaricato viene aggiornato solo dopo 30 giorni.
5. **Budget OMDb**: il piano free di OMDb consente 1.000 richieste al giorno. Il sync ne usa al massimo 900 e dà precedenza ai titoli più visti. Al primo avvio i voti si completano quindi in 3–4 notti; il sito mostra quanti titoli sono ancora in attesa. Con la chiave OMDb a pagamento (Patreon, da 1 $/mese) basta alzare `OMDB_DAILY_BUDGET`.

## Chiavi necessarie (gratuite)

| Variabile | Dove ottenerla | A cosa serve |
|---|---|---|
| `TMDB_TOKEN` | themoviedb.org/settings/api. Va bene sia l'API key v3 sia il token di lettura v4. | Cataloghi, piattaforme, categorie |
| `OMDB_KEY` | omdbapi.com/apikey.aspx | Voti IMDb e Rotten Tomatoes |

## Opzione A: GitHub Pages (gratis, senza server)

1. Crea un repository su GitHub e carica questa cartella sul branch `main`.
2. In **Settings → Secrets and variables → Actions**, aggiungi i secret `TMDB_TOKEN` e `OMDB_KEY`.
3. In **Settings → Pages**, imposta la sorgente su **GitHub Actions**.
4. In **Actions → Aggiorna cataloghi**, premi **Run workflow** per il primo aggiornamento.

Da quel momento il workflow:
- gira ogni notte e pubblica il sito su `https://<utente>.github.io/<repo>/`;
- salva la cache dei voti in `data/ratings.json`, così ogni notte usa il budget OMDb solo per i titoli nuovi o scaduti.

Se il repository è privato, GitHub Pages richiede un piano a pagamento. In alternativa puoi usare un repository pubblico: le chiavi restano comunque nei secret e non vengono mai pubblicate.

## Opzione B: server proprio (VPS, Docker)

```bash
cp .env.example .env      # inserisci le chiavi
npm run sync              # primo aggiornamento manuale (facoltativo)
npm start                 # http://localhost:8080
```

Il server:
- serve il sito;
- rilancia il sync ogni notte all'ora indicata in `SYNC_HOUR`;
- espone `/api/health` per verificare lo stato dell'ultimo aggiornamento.

Con Docker:

```bash
docker build -t guida-streaming .
docker run -d --name guida-streaming -p 8080:8080 --env-file .env -v guida-data:/app/data guida-streaming
```

Il volume `guida-data` conserva la cache dei voti tra un riavvio e l'altro.

Serve Node 20 o successivo. Non ci sono dipendenze npm da installare.

## Personalizzazione

- `PROVIDERS=8,119,337`: fissa l'elenco delle piattaforme. Questi sono gli ID TMDB di Netflix, Prime Video e Disney+. Gli ID di tutte le piattaforme compaiono nel log del sync e in `data.json`.
- `PAGES_POPULAR` / `PAGES_RECENT`: aumentano o riducono la profondità del catalogo. Più titoli significano anche più notti per completare i voti.
- `REGION` / `LANGUAGE`: permettono di generare la guida per un altro paese.

## Limiti noti

- TMDB non indica la data in cui un titolo è stato aggiunto a una piattaforma. "Uscite recenti" si basa quindi sulla data di uscita del film o della serie.
- Per molte serie OMDb non ha il Tomatometer: in quei casi compare solo il voto IMDb.
- Il catalogo copre i titoli più visti e più recenti di ogni piattaforma, non l'intero archivio.

## Attribuzione

La disponibilità sulle piattaforme è fornita da JustWatch tramite TMDB. I voti provengono da OMDb. Questo prodotto usa l'API di TMDB ma non è approvato né certificato da TMDB.
