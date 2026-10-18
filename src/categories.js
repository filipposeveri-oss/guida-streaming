// Categorie unificate per film e serie: TMDB usa ID genere diversi per i due tipi.
export const CATS = [
  { id: 'azione',   name: 'Azione e avventura',     movie: [28, 12],     tv: [10759] },
  { id: 'commedia', name: 'Commedia',               movie: [35],         tv: [35] },
  { id: 'dramma',   name: 'Drammatico',             movie: [18],         tv: [18] },
  { id: 'crime',    name: 'Crime',                  movie: [80],         tv: [80] },
  { id: 'thriller', name: 'Thriller e mistero',     movie: [53, 9648],   tv: [9648] },
  { id: 'scifi',    name: 'Fantascienza e fantasy', movie: [878, 14],    tv: [10765] },
  { id: 'horror',   name: 'Horror',                 movie: [27],         tv: [] },
  { id: 'romance',  name: 'Romantico',              movie: [10749],      tv: [] },
  { id: 'anim',     name: 'Animazione',             movie: [16],         tv: [16] },
  { id: 'family',   name: 'Famiglia e bambini',     movie: [10751],      tv: [10751, 10762] },
  { id: 'doc',      name: 'Documentari',            movie: [99],         tv: [99] },
  { id: 'storia',   name: 'Storia e guerra',        movie: [36, 10752],  tv: [10768] },
  { id: 'reality',  name: 'Reality e talk show',    movie: [],           tv: [10764, 10767] },
  { id: 'musica',   name: 'Musica',                 movie: [10402],      tv: [] },
  { id: 'western',  name: 'Western',                movie: [37],         tv: [37] },
  { id: 'altro',    name: 'Altro',                  movie: [10770],      tv: [10763, 10766] },
];

export const genreToCat = { movie: {}, tv: {} };
for (const c of CATS) {
  for (const g of c.movie) genreToCat.movie[g] = c.id;
  for (const g of c.tv) genreToCat.tv[g] = c.id;
}

export function catsFor(type, genreIds = []) {
  const set = new Set(genreIds.map((g) => genreToCat[type][g]).filter(Boolean));
  if (!set.size) set.add('altro');
  return [...set];
}
