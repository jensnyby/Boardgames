// Telefoner som råkar öppna TV-adressen skickas till spelarsidan.
if (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600) {
  location.replace('spela.html' + location.search);
}

let state = null;
let tick = null;
let phaseShown = null;
let codeShown = null;

const host = new QuizHost((s) => {
  state = s;
  state.receivedAt = performance.now();
  render();
});

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
  if (state.phase === 'lobby') renderLobby(changed);
  if (state.phase === 'question') renderQuestion();
  if (state.phase === 'reveal') renderReveal(changed);
  if (state.phase === 'final') renderFinal(changed);
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
  $('#start').disabled = players.length === 0;
  $('#start-hint').textContent = players.length
    ? `${state.settings.count} frågor · ${categoryLabel(state)}`
    : 'Minst en spelare behövs';
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
  $('#q-text').textContent = q.text;
  $('#q-options').innerHTML = optionsHtml(q, false);
  const active = state.players.filter((p) => p.connected);
  $('#q-answered').textContent = `${active.filter((p) => p.answered).length} / ${active.length} har svarat`;
  countdown($('#timer-fill'), $('#timer-num'), q.remainingMs, q.duration * 1000);
}

function renderReveal(changed) {
  show('reveal');
  const q = state.question;
  const last = q.number === q.total;
  $('#r-num').textContent = `Fråga ${q.number} / ${q.total}`;
  $('#r-cat').textContent = `${q.category.icon} ${q.category.name}`;
  $('#r-text').textContent = q.text;
  $('#r-options').innerHTML = optionsHtml(q, true);
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

$('#start').addEventListener('click', () => host.start());
$('#next').addEventListener('click', () => host.next());
$('#again').addEventListener('click', () => host.restart());
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
