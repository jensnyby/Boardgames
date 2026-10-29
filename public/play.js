const params = new URLSearchParams(location.search);
let me = JSON.parse(localStorage.getItem('quizPlayer') || 'null'); // { id, name, code }
let state = null;
let tick = null;
let lastRendered = '';

// ---------- Uppkoppling till TV:n ----------

let peer = null;
let conn = null;
let target = null; // { code, name, silent } – det spel vi försöker ansluta till
let lastMessageAt = 0;
let reconnectTimer = null;

function send(t, data = {}) {
  if (conn && conn.open) conn.send({ t, ...data });
}

function connect(code, name, silent) {
  target = { code, name, silent };
  clearTimeout(reconnectTimer);
  setOverlay(silent ? 'Återansluter till spelet …' : 'Ansluter …');
  if (!peer || peer.destroyed) {
    peer = new Peer(peerOptions());
    peer.on('open', () => target && openConnection());
    peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.disconnected && peer.reconnect(), 1000));
    peer.on('error', onPeerError);
  } else if (peer.open) {
    openConnection();
  } else if (peer.disconnected) {
    peer.reconnect();
  }
}

function openConnection() {
  if (conn) {
    const old = conn;
    conn = null;
    old.close();
  }
  const { code, name } = target;
  const c = peer.connect(PEER_PREFIX + code, { reliable: true });
  conn = c;
  c.on('open', () => {
    lastMessageAt = Date.now();
    c.send({ t: 'join', name, id: me?.code === code ? me.id : null });
  });
  c.on('data', (msg) => {
    if (c !== conn) return;
    lastMessageAt = Date.now();
    onMessage(msg);
  });
  c.on('close', () => c === conn && connectionLost());
  c.on('error', () => c === conn && connectionLost());
}

function onPeerError(err) {
  if (err.type === 'peer-unavailable' && target) {
    if (target.silent) return connectionLost(); // TV:n laddas kanske om – försök igen
    target = null;
    setOverlay(null);
    $('#join-error').textContent = 'Hittar inget spel med den koden.';
    return;
  }
  if (!peer.open) {
    // Kunde inte nå PeerJS-servern – börja om med en ny peer.
    peer.destroy();
    connectionLost();
  }
}

function connectionLost() {
  if (!target || !me) {
    if (target) {
      setOverlay(null);
      $('#join-error').textContent = 'Kunde inte ansluta. Kontrollera internetanslutningen.';
      target = null;
    }
    return;
  }
  setOverlay('Återansluter till spelet …');
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(me.code, me.name, true), 2000);
}

// Håll kontakten vid liv och märk om TV:n slutar svara.
setInterval(() => {
  if (!conn || !conn.open) return;
  send('ping');
  if (me && Date.now() - lastMessageAt > 9000) connectionLost();
}, 3000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && me && (!conn || !conn.open || Date.now() - lastMessageAt > 5000)) {
    connect(me.code, me.name, true);
  }
});

function onMessage(msg) {
  if (msg.t === 'joined') {
    me = { id: msg.id, name: msg.name, code: msg.code };
    localStorage.setItem('quizPlayer', JSON.stringify(me));
    $('#join-error').textContent = '';
    $('#join').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#me-name').textContent = `👤 ${me.name}`;
    setOverlay(null);
  } else if (msg.t === 'error') {
    setOverlay(null);
    target = null;
    $('#join-error').textContent = msg.error;
    showJoin();
  } else if (msg.t === 'state' && me) {
    state = msg.state;
    state.receivedAt = performance.now();
    setOverlay(null);
    render();
  }
}

function setOverlay(text) {
  const el = $('#overlay');
  el.classList.toggle('hidden', !text);
  if (text) $('#overlay-text').textContent = text;
}

function showJoin() {
  me = null;
  state = null;
  lastRendered = '';
  $('#game').classList.add('hidden');
  $('#join').classList.remove('hidden');
}

function leaveGame() {
  send('leave');
  localStorage.removeItem('quizPlayer');
  target = null;
  clearTimeout(reconnectTimer);
  setOverlay(null);
  showJoin();
}

$('#code-input').value = (params.get('r') || me?.code || '').toUpperCase();
$('#name-input').value = me?.name || '';

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#join-error').textContent = '';
  const code = $('#code-input').value.trim().toUpperCase();
  if (me && me.code !== code) me = null;
  connect(code, $('#name-input').value.trim(), false);
});

$('#overlay-cancel').addEventListener('click', leaveGame);

// Var vi redan med i ett spel? Hoppa in igen direkt.
if (me && (!params.get('r') || params.get('r').toUpperCase() === me.code)) connect(me.code, me.name, true);

function myPlayer() {
  return state.players.find((p) => p.id === me.id);
}

function isLeader() {
  return state.leaderId === me.id;
}

function render() {
  const p = myPlayer();
  if (!p) return;
  $('#me-score').textContent = `⭐ ${p.score} p`;
  const view = $('#view');
  const key = `${state.phase}|${state.question?.number}|${p.answered}`;
  const fresh = key !== lastRendered;
  lastRendered = key;
  clearInterval(tick);

  if (state.phase === 'lobby') {
    if (isLeader()) {
      // Ritas om varje gång så att ändringar från TV:n syns.
      view.innerHTML = `
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
        <div class="card">
          <h2>👑 Du är spelledare</h2>
          <div id="settings" style="display:flex;flex-direction:column;gap:14px"></div>
        </div>
        <button class="btn primary big" id="start" ${state.loading ? 'disabled' : ''}>${state.loading ? '⏳ Hämtar låtar …' : '▶ Starta quizet'}</button>
        <p class="sub" style="text-align:center">${state.players.filter((x) => x.connected).length} spelare med</p>`;
      renderSettings($('#settings'), state, (s) => send('settings', { settings: s }));
      $('#start').onclick = () => send('start');
    } else {
      const leader = state.players.find((x) => x.id === state.leaderId);
      view.innerHTML = `
        <div class="center-msg">
          <div class="big-icon">🇫🇮</div>
          <div class="title">Du är med!</div>
          <div class="muted">${esc(leader ? leader.name : 'Spelledaren')} väljer inställningar och startar quizet.</div>
          <div class="chip">${esc(categoryLabel(state))} · ${state.settings.count} frågor · ${state.settings.time} s</div>
        </div>`;
    }
    return;
  }

  if (state.phase === 'question') {
    const q = state.question;
    if (p.answered) {
      if (fresh) {
        view.innerHTML = `
          <div class="center-msg">
            <div class="big-icon">⏳</div>
            <div class="title">Svaret är skickat!</div>
            <div class="muted">Väntar på de andra …</div>
          </div>`;
      }
      return;
    }
    if (fresh) {
      view.innerHTML = `
        <div class="chip" style="align-self:center">Fråga ${q.number} / ${q.total}${q.hasAudio ? ' · 🎧 Lyssna på TV:n' : ''}</div>
        <div class="phone-q">${esc(q.text)}</div>
        <div class="phone-timer"><div id="pt"></div></div>
        <div class="opt-grid">
          ${q.options
            .map((o, i) => `<button class="opt-btn ${OPT_CLASSES[i]}" data-i="${i}"><span class="shape">${OPT_SHAPES[i]}</span>${esc(o)}</button>`)
            .join('')}
        </div>`;
      view.querySelectorAll('.opt-btn').forEach((b) =>
        b.addEventListener('click', () => {
          send('answer', { choice: Number(b.dataset.i) });
          navigator.vibrate?.(30);
          view.querySelectorAll('.opt-btn').forEach((x) => (x.disabled = true));
          b.style.boxShadow = '0 0 0 4px #fff';
        })
      );
    }
    const end = state.receivedAt + q.remainingMs;
    const step = () => {
      const fill = $('#pt');
      if (fill) fill.style.width = `${(Math.max(0, end - performance.now()) / (q.duration * 1000)) * 100}%`;
    };
    step();
    tick = setInterval(step, 100);
    return;
  }

  if (state.phase === 'reveal') {
    const q = state.question;
    const rank = state.players.findIndex((x) => x.id === me.id) + 1;
    const last = q.number === q.total;
    if (fresh && p.lastCorrect) navigator.vibrate?.([40, 60, 40]);
    view.innerHTML = `
      <div class="result ${p.lastCorrect ? 'good' : 'bad'}">
        <div class="title">${p.lastCorrect ? '✅ Rätt!' : p.answered ? '❌ Fel' : '⌛ Tiden tog slut'}</div>
        <div class="gain">${p.lastCorrect ? `+${p.lastGain} poäng` : 'Inga poäng den här gången'}</div>
      </div>
      <div class="card">
        <h2>Rätt svar</h2>
        <div class="opt-btn ${OPT_CLASSES[q.correct]}"><span class="shape">${OPT_SHAPES[q.correct]}</span>${esc(q.options[q.correct])}</div>
        ${q.song ? `<div class="sub">🎵 ${esc(q.song.artist)} – ${esc(q.song.title)}</div>` : ''}
      </div>
      <div class="center-msg" style="flex:0">
        <div class="title">Du ligger på plats ${rank} av ${state.players.length}</div>
      </div>
      ${isLeader() ? `<button class="btn primary big" id="next">${last ? 'Visa resultatet 🏆' : 'Nästa fråga ▶'}</button>` : ''}`;
    if (isLeader()) $('#next').onclick = () => send('next');
    return;
  }

  if (state.phase === 'final') {
    const rank = state.players.findIndex((x) => x.id === me.id) + 1;
    const medal = ['🥇', '🥈', '🥉'][rank - 1] || '🎉';
    view.innerHTML = `
      <div class="center-msg">
        <div class="big-icon">${medal}</div>
        <div class="title">Plats ${rank} av ${state.players.length}</div>
        <div class="muted">Du fick ${p.score} poäng</div>
      </div>
      ${isLeader() ? '<button class="btn primary big" id="again">↻ Spela igen</button>' : '<p class="sub" style="text-align:center">Spelledaren kan starta en ny omgång.</p>'}
      <div class="card">
        <h2>📋 Rätta svar</h2>
        <div class="phone-recap">
          ${(state.history || [])
            .map((h) => {
              const mark = h.results[me.id] === true ? '✅' : h.results[me.id] === false ? '❌' : '➖';
              const song = h.song && h.song !== h.answer ? ` <span class="q">(${esc(h.song)})</span>` : '';
              return `<div class="item"><div class="q">${h.number}. ${esc(h.text)}</div><div class="a">${mark} ${esc(h.answer)}${song}</div></div>`;
            })
            .join('')}
        </div>
      </div>
      <button class="btn big" id="leave">Lämna spelet</button>`;
    if (isLeader()) $('#again').onclick = () => send('restart');
    $('#leave').onclick = leaveGame;
  }
}
