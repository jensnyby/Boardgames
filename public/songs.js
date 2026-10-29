// Hämtar 30 sekunders förhandsklipp från Apples öppna sök-API (inget konto behövs).
// JSONP används eftersom API:t inte alltid tillåter vanliga anrop från andra webbplatser.

const SONG_CACHE_KEY = 'songCache';

function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function bestMatch(song, results) {
  const artist = normalize(song.artist);
  const title = normalize(song.title);
  // Både artist och titel måste stämma, annars kan fel låt (t.ex. en cover) spelas.
  const hit = results.find(
    (r) => r.previewUrl && normalize(r.artistName).includes(artist) && normalize(r.trackName).includes(title)
  );
  if (!hit) return null;
  return {
    url: hit.previewUrl,
    artwork: (hit.artworkUrl100 || '').replace('100x100bb', '400x400bb'),
  };
}

function searchItunes(song) {
  return new Promise((resolve) => {
    const callback = `itunes_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const done = (result) => {
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
      resolve(result);
    };
    const timeout = setTimeout(() => done(null), 8000);
    window[callback] = (data) => done(bestMatch(song, (data && data.results) || []));
    script.onerror = () => done(null);
    const params = new URLSearchParams({ term: `${song.artist} ${song.title}`, entity: 'song', country: 'FI', limit: '15', callback });
    script.src = `https://itunes.apple.com/search?${params}`;
    document.head.appendChild(script);
  });
}

async function findClip(song) {
  const key = `${song.artist}|${song.title}`;
  let cache = {};
  try {
    cache = JSON.parse(sessionStorage.getItem(SONG_CACHE_KEY)) || {};
  } catch {}
  if (cache[key]) return cache[key];
  const clip = await searchItunes(song);
  if (clip) {
    cache[key] = clip;
    try {
      sessionStorage.setItem(SONG_CACHE_KEY, JSON.stringify(cache));
    } catch {}
  }
  return clip;
}
