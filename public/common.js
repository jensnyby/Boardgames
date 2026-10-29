// Delad kod för TV-skärmen och telefonerna.

const OPT_CLASSES = ['opt-a', 'opt-b', 'opt-c', 'opt-d'];
const OPT_SHAPES = ['▲', '◆', '●', '■'];
const TIME_OPTIONS = [10, 15, 20, 30];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function $(sel) {
  return document.querySelector(sel);
}

// Ritar inställningarna (kategori, antal frågor, tid). emit(settings) skickar ändringar.
function renderSettings(el, state, emit) {
  const s = state.settings;
  const max = state.categories.find((c) => c.id === s.category)?.count || 1;
  const focusedKey = document.activeElement?.dataset?.key;

  el.innerHTML = `
    <div class="cats">
      ${state.categories
        .map(
          (c) => `
        <button class="cat ${c.id === s.category ? 'selected' : ''}" data-key="cat-${c.id}" data-cat="${c.id}">
          <span class="icon">${c.icon}</span>
          <span class="name">${esc(c.name)}</span>
          <span class="count">${c.count} frågor</span>
        </button>`
        )
        .join('')}
    </div>
    <div class="setting-row">
      <span class="setting-label">Antal frågor</span>
      <span class="stepper">
        <button class="btn" data-key="minus" data-step="-5" ${s.count <= 1 ? 'disabled' : ''}>−</button>
        <span class="value">${s.count}</span>
        <button class="btn" data-key="plus" data-step="5" ${s.count >= max ? 'disabled' : ''}>+</button>
        <button class="btn" data-key="all" data-all ${s.count >= max ? 'disabled' : ''}>Alla</button>
      </span>
    </div>
    <div class="setting-row">
      <span class="setting-label">Tid per fråga</span>
      <span class="seg">
        ${TIME_OPTIONS.map((t) => `<button class="btn ${t === s.time ? 'selected' : ''}" data-key="time-${t}" data-time="${t}">${t} s</button>`).join('')}
      </span>
    </div>`;

  el.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => {
      const cat = state.categories.find((c) => c.id === b.dataset.cat);
      emit({ category: cat.id, count: Math.min(s.count, cat.count) });
    })
  );
  el.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const step = Number(b.dataset.step);
      // Hoppa till jämna femtal: 1 → 5 → 10 …
      let next = step > 0 ? Math.floor(s.count / 5) * 5 + 5 : Math.ceil(s.count / 5) * 5 - 5;
      next = Math.max(1, Math.min(max, next));
      emit({ count: next });
    })
  );
  el.querySelector('[data-all]').addEventListener('click', () => emit({ count: max }));
  el.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => emit({ time: Number(b.dataset.time) })));

  // Behåll fokus vid omritning (viktigt för TV-fjärrkontrollen).
  if (focusedKey) {
    const again = el.querySelector(`[data-key="${focusedKey}"]`);
    if (again && !again.disabled) again.focus();
  }
}

function categoryLabel(state) {
  const c = state.categories.find((x) => x.id === state.settings.category);
  return c ? `${c.icon} ${c.name}` : '';
}

// ---------- Uppkoppling ----------
// Telefonerna kopplar upp sig direkt mot TV:ns webbläsare (WebRTC via PeerJS).
// PeerJS gratistjänst används för att hitta varandra. Med ?peer=värd:port kan en egen PeerJS-server användas.

const PEER_PREFIX = 'finlandquiz-';
const CUSTOM_PEER = new URLSearchParams(location.search).get('peer');

function peerOptions() {
  if (!CUSTOM_PEER) return { debug: 1 };
  const [host, port = '443'] = CUSTOM_PEER.split(':');
  return { host, port: Number(port), path: '/', secure: port === '443', debug: 1 };
}
