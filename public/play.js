const socket = io();
const params = new URLSearchParams(location.search);
let me = JSON.parse(localStorage.getItem('quizPlayer') || 'null'); // { id, name, code }
let state = null;
let tick = null;
let lastRendered = '';

$('#code-input').value = (params.get('r') || me?.code || '').toUpperCase();
$('#name-input').value = me?.name || '';

function join(code, name, silent) {
  socket.emit('player:join', { code, name, id: me?.code === code ? me.id : null }, (res) => {
    if (res.error) {
      if (!silent) $('#join-error').textContent = res.error;
      showJoin();
      return;
    }
    me = res;
    localStorage.setItem('quizPlayer', JSON.stringify(me));
    $('#join-error').textContent = '';
    $('#join').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#me-name').textContent = `👤 ${me.name}`;
  });
}

function showJoin() {
  me = null;
  state = null;
  lastRendered = '';
  $('#game').classList.add('hidden');
  $('#join').classList.remove('hidden');
}

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  join($('#code-input').value.trim().toUpperCase(), $('#name-input').value.trim(), false);
});

// Återanslut automatiskt (t.ex. om telefonen låsts en stund).
socket.on('connect', () => {
  const code = (params.get('r') || '').toUpperCase();
  if (me && (!code || code === me.code)) join(me.code, me.name, true);
});

socket.on('state', (s) => {
  if (!me) return;
  state = s;
  state.receivedAt = performance.now();
  render();
});

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
        <div class="card">
          <h2>👑 Du är spelledare</h2>
          <div id="settings" style="display:flex;flex-direction:column;gap:14px"></div>
        </div>
        <button class="btn primary big" id="start">▶ Starta quizet</button>
        <p class="sub" style="text-align:center">${state.players.filter((x) => x.connected).length} spelare med</p>`;
      renderSettings($('#settings'), state, (s) => socket.emit('settings', s));
      $('#start').onclick = () => socket.emit('start');
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
        <div class="chip" style="align-self:center">Fråga ${q.number} / ${q.total}</div>
        <div class="phone-q">${esc(q.text)}</div>
        <div class="phone-timer"><div id="pt"></div></div>
        <div class="opt-grid">
          ${q.options
            .map((o, i) => `<button class="opt-btn ${OPT_CLASSES[i]}" data-i="${i}"><span class="shape">${OPT_SHAPES[i]}</span>${esc(o)}</button>`)
            .join('')}
        </div>`;
      view.querySelectorAll('.opt-btn').forEach((b) =>
        b.addEventListener('click', () => {
          socket.emit('answer', Number(b.dataset.i));
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
      </div>
      <div class="center-msg" style="flex:0">
        <div class="title">Du ligger på plats ${rank} av ${state.players.length}</div>
      </div>
      ${isLeader() ? `<button class="btn primary big" id="next">${last ? 'Visa resultatet 🏆' : 'Nästa fråga ▶'}</button>` : ''}`;
    if (isLeader()) $('#next').onclick = () => socket.emit('next');
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
      <button class="btn big" id="leave">Lämna spelet</button>`;
    if (isLeader()) $('#again').onclick = () => socket.emit('restart');
    $('#leave').onclick = () => {
      socket.emit('leave');
      localStorage.removeItem('quizPlayer');
      showJoin();
    };
  }
}
