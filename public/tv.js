// Telefoner som råkar öppna TV-adressen skickas till spelarsidan.
if (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600) {
  location.replace('spela.html' + location.search);
}

let state = null;
let host = null;
let tick = null;
let phaseShown = null;
let codeShown = null;
let recapPage = null; // sida i genomgången av rätta svar, null = visa prispallen
const RECAP_PER_PAGE = 8;

// ---------- Ljud ----------
// Webbläsare spelar bara ljud efter ett knapptryck på sidan. Första trycket "låser upp" ljudspelaren.

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const audio = $('#audio');
const preload = new Audio();
preload.preload = 'auto';
let soundUnlocked = false;
let audioKey = null;

const bgMusic = new BackgroundMusic();
let musicOn = true;
try {
  musicOn = localStorage.getItem('bgMusic') !== 'off';
} catch {}

function unlockSound() {
  bgMusic.unlock();
  if (soundUnlocked) return;
  soundUnlocked = true;
  if (!audioKey) {
    audio.src = SILENT_WAV;
    audio.play().catch(() => {});
  }
  if (state) render();
}
document.addEventListener('click', unlockSound, true);
document.addEventListener('keydown', unlockSound, true);

function currentSong() {
  if (!host) return null; // första anropet sker innan host har tilldelats
  const q = host.room.questions[host.room.index];
  return (state.phase === 'question' || state.phase === 'reveal') && q?.song?.url ? q.song : null;
}

function syncAudio() {
  const song = currentSong();
  if (!song) {
    audio.pause();
    audioKey = null;
    $('#play-overlay').classList.add('hidden');
    return;
  }
  const key = `${host.room.index}|${song.url}`;
  if (key === audioKey) return;
  audioKey = key;
  audio.src = song.url;
  playAudio();
  const next = host.room.questions[host.room.index + 1];
  if (next?.song?.url) preload.src = next.song.url;
}

function playAudio() {
  audio
    .play()
    .then(() => $('#play-overlay').classList.add('hidden'))
    .catch(() => {
      $('#play-overlay').classList.remove('hidden');
      $('#play-btn').focus();
    });
}

$('#play-btn').addEventListener('click', playAudio);

// Bakgrundsmusik under frågor och rätt svar, men inte när Gissa låten spelar sitt klipp.
function updateMusic() {
  const playing = musicOn && soundUnlocked && ['question', 'reveal'].includes(state.phase) && !currentSong();
  bgMusic.setPlaying(playing);
  for (const btn of document.querySelectorAll('.music-btn')) btn.textContent = musicOn ? '🎵 Musik på' : '🔇 Musik av';
}

for (const btn of document.querySelectorAll('.music-btn')) {
  btn.addEventListener('click', () => {
    musicOn = !musicOn;
    try {
      localStorage.setItem('bgMusic', musicOn ? 'on' : 'off');
    } catch {}
    if (state) render();
  });
}
$('#r-art').addEventListener('error', () => $('#r-art').classList.add('hidden'));

function renderJoin() {
  $('#status').textContent = { online: '● Ansluten', connecting: '◌ Ansluter …', offline: '✕ Ingen internetanslutning' }[state.status];
  $('#status').dataset.status = state.status;
  if (codeShown === state.code) return;
  codeShown = state.code;
  const url = new URL(`spela.html?r=${state.code}`, location.href);
  if (CUSTOM_PEER) url.searchParams.set('peer', CUSTOM_PEER);
  $('#join-url').textContent = `${url.host}${url.pathname}`;
  $('#code').textContent = state.code;
  const qr = qrcode(0, 'M');
  qr.addData(url.href);
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function show(id) {
  for (const s of document.querySelectorAll('section.screen')) s.classList.toggle('hidden', s.id !== id);
}

function render() {
  const changed = phaseShown !== state.phase;
  phaseShown = state.phase;
  clearInterval(tick);
  renderJoin();
  syncAudio();
  updateMusic();
  if (state.phase === 'lobby') renderLobby(changed);
  if (state.phase === 'question') renderQuestion();
  if (state.phase === 'reveal') renderReveal(changed);
  if (state.phase !== 'final') recapPage = null;
  if (state.phase === 'final') recapPage === null ? renderFinal(changed) : renderRecap();
}

function renderLobby(changed) {
  show('lobby');
  renderSettings($('#tv-settings'), state, (s) => host.updateSettings(s));
  const players = state.players.filter((p) => p.connected);
  $('#player-title').textContent = `Spelare (${players.length})`;
  $('#players').innerHTML = players.length
    ? players
        .map((p) => `<span class="chip">${p.id === state.leaderId ? '<span class="crown" title="Spelledare">👑</span>' : ''}${esc(p.name)}</span>`)
        .join('')
    : '<span class="empty">Väntar på spelare …</span>';
  $('#start').disabled = players.length === 0 || state.loading;
  $('#start').textContent = state.loading ? '⏳ Hämtar låtar …' : '▶ Starta quizet';
  $('#start-hint').textContent = state.error
    ? state.error
    : players.length
      ? `${state.settings.count} frågor · ${categoryLabel(state)}`
      : 'Minst en spelare behövs';
  const usesSongs = state.settings.category === 'blandat' || isSongCategory(state.settings.category);
  $('#sound-btn').classList.toggle('hidden', !(usesSongs || musicOn) || soundUnlocked);
  if (changed) $('#start').focus();
}

function countdown(fillEl, numEl, remainingMs, totalMs, onTick) {
  const end = state.receivedAt + remainingMs;
  const step = () => {
    const left = Math.max(0, end - performance.now());
    if (fillEl) fillEl.style.width = `${(left / totalMs) * 100}%`;
    if (numEl) numEl.textContent = Math.ceil(left / 1000);
    onTick?.(left);
  };
  step();
  tick = setInterval(step, 100);
}

function optionsHtml(q, reveal) {
  return q.options
    .map((o, i) => {
      const cls = reveal ? (i === q.correct ? 'right' : 'dim') : '';
      const count = reveal ? `<span class="count">${q.counts[i]}</span>` : '';
      return `<div class="option ${OPT_CLASSES[i]} ${cls}"><span class="shape">${OPT_SHAPES[i]}</span><span>${esc(o)}</span>${count}</div>`;
    })
    .join('');
}

function renderQuestion() {
  show('question');
  const q = state.question;
  $('#q-num').textContent = `Fråga ${q.number} / ${q.total}`;
  $('#q-cat').textContent = `${q.category.icon} ${q.category.name}`;
  $('#q-text').textContent = q.hasAudio ? `🎧 ${q.text}` : q.clueCount ? `🚂 ${q.text}` : q.text;
  $('#q-text').classList.toggle('small', !!q.clueCount);
  $('#q-eq').classList.toggle('hidden', !q.hasAudio);
  $('#q-clues').classList.toggle('hidden', !q.clueCount);
  $('#q-options').innerHTML = optionsHtml(q, false);
  const active = state.players.filter((p) => p.connected);
  $('#q-answered').textContent = `${active.filter((p) => p.answered).length} / ${active.length} har svarat`;
  let shownClues = -1;
  countdown($('#timer-fill'), $('#timer-num'), q.remainingMs, q.duration * 1000, (left) => {
    if (!q.clueCount) return;
    // Visa en ny ledtråd i taget, med poängen den är värd.
    const shown = Math.min(Math.floor((q.duration * 1000 - left) / (q.clueSeconds * 1000)), q.clueCount - 1);
    if (shown === shownClues) return;
    shownClues = shown;
    const clues = host.room.questions[host.room.index].clues;
    $('#q-clues').innerHTML = clues
      .slice(0, shown + 1)
      .map((c, i) => `<div class="clue ${i === shown ? 'current' : ''}"><span class="pts">${(q.clueCount - i) * 200} p</span>${esc(c)}</div>`)
      .join('');
  });
}

function renderReveal(changed) {
  show('reveal');
  const q = state.question;
  const last = q.number === q.total;
  $('#r-num').textContent = `Fråga ${q.number} / ${q.total}`;
  $('#r-cat').textContent = `${q.category.icon} ${q.category.name}`;
  $('#r-text').textContent = q.text;
  $('#r-answer').textContent = `✔ Rätt svar: ${q.options[q.correct]}`;
  $('#r-options').innerHTML = optionsHtml(q, true);
  $('#r-song').classList.toggle('hidden', !q.song);
  if (q.song) {
    $('#r-art').src = q.song.artwork || '';
    $('#r-art').classList.toggle('hidden', !q.song.artwork);
    $('#r-song-text').textContent = `${q.song.artist} – ${q.song.title}`;
  }
  $('#r-board').innerHTML = state.players
    .slice(0, 8)
    .map(
      (p, i) => `
      <div class="board-row ${p.connected ? '' : 'off'}">
        <span class="pos">${i + 1}.</span>
        <span class="name">${esc(p.name)}</span>
        ${p.lastGain ? `<span class="gain">+${p.lastGain}</span>` : ''}
        <span class="score">${p.score}</span>
      </div>`
    )
    .join('');
  $('#next').textContent = last ? 'Se resultatet 🏆' : 'Nästa fråga ▶';
  countdown(null, null, state.remainingRevealMs, state.revealSeconds * 1000, (left) => {
    const s = Math.ceil(left / 1000);
    $('#r-countdown').textContent = last ? `Resultatet visas om ${s} s` : `Nästa fråga om ${s} s`;
  });
  if (changed) $('#next').focus();
}

function renderFinal(changed) {
  show('final');
  const [p1, p2, p3, ...rest] = state.players;
  const place = (p, n) =>
    p
      ? `<div class="place p${n}"><div class="pname">${esc(p.name)}</div><div class="pscore">${p.score} p</div><div class="block">${n}</div></div>`
      : `<div class="place p${n}"></div>`;
  $('#podium').innerHTML = place(p2, 2) + place(p1, 1) + place(p3, 3);
  $('#final-rest').innerHTML = rest
    .map((p, i) => `<div class="board-row"><span class="pos">${i + 4}.</span><span class="name">${esc(p.name)}</span><span class="score">${p.score}</span></div>`)
    .join('');
  if (changed) $('#again').focus();
}

function renderRecap() {
  show('recap');
  const pages = Math.max(1, Math.ceil(state.history.length / RECAP_PER_PAGE));
  recapPage = Math.min(Math.max(0, recapPage), pages - 1);
  const items = state.history.slice(recapPage * RECAP_PER_PAGE, (recapPage + 1) * RECAP_PER_PAGE);
  $('#recap-list').innerHTML = items
    .map(
      (h) => `
      <div class="recap-item">
        <div class="recap-q">${h.number}. ${esc(h.text)}</div>
        <div class="recap-a">✔ ${esc(h.answer)}</div>
        ${h.song && h.song !== h.answer ? `<div class="recap-song">🎵 ${esc(h.song)}</div>` : ''}
        <div class="recap-stat">${h.right} av ${h.total} svarade rätt</div>
      </div>`
    )
    .join('');
  $('#recap-page').textContent = `Sida ${recapPage + 1} / ${pages}`;
  $('#recap-prev').disabled = recapPage === 0;
  $('#recap-next').disabled = recapPage >= pages - 1;
  const focused = document.activeElement;
  if (!focused || focused.disabled || !$('#recap').contains(focused)) {
    (recapPage < pages - 1 ? $('#recap-next') : $('#recap-back')).focus();
  }
}

function openRecap(page) {
  recapPage = page;
  render();
}

$('#start').addEventListener('click', () => host.start());
$('#next').addEventListener('click', () => host.next());
$('#again').addEventListener('click', () => host.restart());
confirmButton($('#q-end'), () => host.end());
confirmButton($('#r-end'), () => host.end());
$('#recap-btn').addEventListener('click', () => openRecap(0));
$('#recap-prev').addEventListener('click', () => openRecap(recapPage - 1));
$('#recap-next').addEventListener('click', () => openRecap(recapPage + 1));
$('#recap-back').addEventListener('click', () => {
  recapPage = null;
  phaseShown = null; // fokusera "Spela igen" igen
  render();
});
$('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

// Håll TV-skärmen vaken under spelet.
async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}
keepAwake();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());

// Startas sist, när allt ovan är definierat.
host = new QuizHost((s) => {
  state = s;
  state.receivedAt = performance.now();
  render();
});
