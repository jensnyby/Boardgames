// Spellogiken. Körs i TV:ns webbläsare – telefonerna skickar sina svar hit.

const REVEAL_SECONDS = 12;
const CLUE_SECONDS = 8; // På spåret: en ny ledtråd var 8:e sekund // hur länge rätt svar + ställning visas innan nästa fråga
const STORE_KEY = 'quizRoom';
const PING_TIMEOUT_MS = 10000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Frågor i en kategori som matchar vald svårighetsgrad (0 = alla).
function questionsFor(id, level = 0) {
  return level ? QUESTIONS[id].filter((q) => q.d === level) : QUESTIONS[id];
}

function categoryInfo(level = 0) {
  const cats = Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c, count: questionsFor(id, level).length }));
  const total = cats.reduce((s, c) => s + c.count, 0);
  // Dolda kategorier (t.ex. Allmänbildning) ingår bara i Blandat.
  return [...cats.filter((c) => !c.hidden), { id: 'blandat', name: 'Blandat', icon: '🎲', count: total }];
}

function pickQuestions(category, count, level = 0) {
  let picked;
  if (category === 'blandat') {
    // Turvis ur varje kategori så att blandningen blir jämn.
    const pools = Object.keys(QUESTIONS).map((id) => shuffle(questionsFor(id, level)).map((q) => ({ ...q, cat: id })));
    picked = [];
    for (let i = 0; picked.length < count; i++) {
      for (const pool of shuffle(pools)) {
        if (pool[i] && picked.length < count) picked.push(pool[i]);
      }
    }
    picked = shuffle(picked);
  } else {
    // Några extra låtar ifall något klipp inte går att hitta.
    const extra = isSongCategory(category) ? 6 : 0;
    picked = shuffle(questionsFor(category, level)).slice(0, count + extra).map((q) => ({ ...q, cat: category }));
  }
  return picked.map((q) => {
    if (q.artist) return { ...songQuestion(q), level: q.d };
    const options = shuffle([q.a, ...q.w]);
    if (q.clues) {
      return { text: 'Vart är vi på väg?', options, correct: options.indexOf(q.a), cat: q.cat, clues: q.clues, level: q.d };
    }
    return { text: q.q, options, correct: options.indexOf(q.a), cat: q.cat, level: q.d };
  });
}

// Låtkategorier har poster med artist och titel i stället för fråga och svar.
function isSongCategory(id) {
  return !!QUESTIONS[id]?.[0]?.artist;
}

function songQuestion(song) {
  const others = QUESTIONS[song.cat].filter((s) => s.artist !== song.artist);
  const askArtist = Math.random() < 0.4;
  const field = askArtist ? 'artist' : 'title';
  const wrong = shuffle([...new Set(others.map((s) => s[field]))]).slice(0, 3);
  const options = shuffle([song[field], ...wrong]);
  return {
    text: askArtist ? 'Vem framför låten?' : 'Vad heter låten?',
    options,
    correct: options.indexOf(song[field]),
    cat: song.cat,
    song: { artist: song.artist, title: song.title },
  };
}

// Hämtar ljudklipp till låtfrågorna. Låtar utan klipp tas bort.
async function attachClips(questions, count) {
  await Promise.all(
    questions.filter((q) => q.song).map(async (q) => {
      const clip = await findClip(q.song);
      if (clip) q.song = { ...q.song, ...clip };
      else q.failed = true;
    })
  );
  return questions.filter((q) => !q.failed).slice(0, count);
}

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

class QuizHost {
  constructor(onChange) {
    this.onChange = onChange;
    this.status = 'connecting'; // connecting | online | offline
    this.room = this.load() || {
      code: newCode(),
      players: new Map(),
      leaderId: null,
      settings: { category: 'blandat', count: 10, time: 20, level: 0 },
      phase: 'lobby', // lobby | question | reveal | final
      questions: [],
      index: -1,
      questionStart: 0,
      revealEndsAt: 0,
    };
    this.retries = 0;
    this.resumeTimers();
    this.openPeer();
    setInterval(() => this.sweep(), 2000);
  }

  // ---------- Uppkoppling ----------

  openPeer() {
    this.setStatus('connecting');
    const peer = new Peer(PEER_PREFIX + this.room.code, peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      this.retries = 0;
      this.setStatus('online');
    });
    peer.on('connection', (conn) => this.handleConn(conn));
    peer.on('disconnected', () => {
      // Tappade kontakten med PeerJS-servern. Redan anslutna telefoner fungerar ändå.
      setTimeout(() => {
        if (peer === this.peer && !peer.destroyed && peer.disconnected) {
          this.setStatus('connecting');
          peer.reconnect();
        }
      }, 1500);
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') return;
      if (err.type === 'unavailable-id') {
        // Koden används redan. Efter en omladdning släpps den gamla snart; annars tar vi en ny kod.
        const hasGame = this.room.players.size > 0 || this.room.phase !== 'lobby';
        if (!hasGame || this.retries >= 8) {
          this.room.code = newCode();
          this.retries = 0;
        } else {
          this.retries++;
        }
      }
      if (!peer.open) {
        this.setStatus('offline');
        peer.destroy();
        setTimeout(() => this.openPeer(), err.type === 'unavailable-id' ? 1500 : 4000);
      }
    });
  }

  setStatus(status) {
    this.status = status;
    this.broadcast();
  }

  handleConn(conn) {
    conn.lastSeen = Date.now();
    conn.on('data', (msg) => {
      conn.lastSeen = Date.now();
      this.handleMessage(conn, msg || {});
    });
    conn.on('close', () => this.dropConn(conn));
    conn.on('error', () => this.dropConn(conn));
  }

  // Telefoner som inte hörts av på en stund räknas som frånkopplade.
  sweep() {
    for (const p of this.room.players.values()) {
      if (p.conn && Date.now() - p.conn.lastSeen > PING_TIMEOUT_MS) this.dropConn(p.conn);
    }
  }

  dropConn(conn) {
    if (conn.dropped) return;
    conn.dropped = true;
    try {
      conn.close();
    } catch {}
    const p = this.room.players.get(conn.playerId);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    p.connected = false;
    if (this.room.phase === 'lobby') this.room.players.delete(p.id);
    this.ensureLeader();
    this.broadcast();
  }

  send(conn, msg) {
    if (conn && conn.open) conn.send(msg);
  }

  handleMessage(conn, msg) {
    if (msg.t === 'ping') return this.send(conn, { t: 'pong' });
    if (msg.t === 'join') return this.join(conn, msg);

    const p = this.room.players.get(conn.playerId);
    if (!p || p.conn !== conn) return;
    const leader = this.room.leaderId === p.id;
    if (msg.t === 'answer') this.answer(p, msg.choice);
    else if (msg.t === 'leave') this.leave(p);
    else if (!leader) return;
    else if (msg.t === 'settings') this.updateSettings(msg.settings || {});
    else if (msg.t === 'start') this.start();
    else if (msg.t === 'next') this.next();
    else if (msg.t === 'restart') this.restart();
    else if (msg.t === 'end') this.end();
  }

  join(conn, { name, id }) {
    const room = this.room;
    const cleanName = String(name || '').trim().slice(0, 16);
    let p = id && room.players.get(id);
    if (!p && cleanName) {
      // Samma namn som en frånkopplad spelare = samma person som kommer tillbaka.
      const same = [...room.players.values()].find((o) => o.name.toLowerCase() === cleanName.toLowerCase());
      if (same && same.connected) return this.send(conn, { t: 'error', error: 'Namnet är redan taget.' });
      p = same;
    }
    if (!p) {
      if (!cleanName) return this.send(conn, { t: 'error', error: 'Skriv ditt namn.' });
      if (room.players.size >= 30) return this.send(conn, { t: 'error', error: 'Spelet är fullt.' });
      p = { id: Math.random().toString(36).slice(2, 10), name: cleanName, score: 0, answer: null, lastGain: 0, lastCorrect: null };
      room.players.set(p.id, p);
    }
    if (p.conn && p.conn !== conn) {
      const old = p.conn;
      p.conn = null;
      old.dropped = true;
      try {
        old.close();
      } catch {}
    }
    p.conn = conn;
    p.connected = true;
    conn.playerId = p.id;
    this.ensureLeader();
    this.send(conn, { t: 'joined', id: p.id, name: p.name, code: room.code });
    this.broadcast();
  }

  // ---------- Spelet ----------

  connectedPlayers() {
    return [...this.room.players.values()].filter((p) => p.connected);
  }

  ensureLeader() {
    const leader = this.room.players.get(this.room.leaderId);
    if (leader && leader.connected) return;
    const next = this.connectedPlayers()[0];
    this.room.leaderId = next ? next.id : null;
  }

  updateSettings(s) {
    const room = this.room;
    if (room.phase !== 'lobby') return;
    room.error = null;
    if ([0, 1, 2, 3].includes(s.level)) room.settings.level = s.level;
    const cats = categoryInfo(room.settings.level);
    const cat = cats.find((c) => c.id === s.category);
    if (cat) room.settings.category = cat.id;
    if (TIME_OPTIONS.includes(s.time)) room.settings.time = s.time;
    const max = cats.find((c) => c.id === room.settings.category).count;
    const count = Number.isInteger(s.count) ? s.count : room.settings.count;
    room.settings.count = Math.max(1, Math.min(max, count));
    this.broadcast();
  }

  async start() {
    const room = this.room;
    if (room.phase !== 'lobby' || room.loading || this.connectedPlayers().length === 0) return;
    room.loading = true;
    room.error = null;
    this.broadcast();
    const questions = await attachClips(pickQuestions(room.settings.category, room.settings.count, room.settings.level), room.settings.count);
    room.loading = false;
    if (room.phase !== 'lobby') return;
    if (questions.length === 0) {
      room.error = 'Kunde inte hämta låtarna. Kontrollera internetanslutningen.';
      this.broadcast();
      return;
    }
    for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
    room.questions = questions;
    room.history = [];
    room.index = -1;
    this.startQuestion();
  }

  startQuestion() {
    const room = this.room;
    clearTimeout(this.timer);
    room.index++;
    if (room.index >= room.questions.length) {
      room.phase = 'final';
      this.broadcast();
      return;
    }
    for (const p of room.players.values()) Object.assign(p, { answer: null, lastGain: 0, lastCorrect: null });
    room.phase = 'question';
    room.questionStart = Date.now();
    this.timer = setTimeout(() => this.reveal(), this.durationMs() + 300);
    this.broadcast();
  }

  // Frågans längd: På spåret-frågor tar en viss tid per ledtråd, övriga följer inställningen.
  durationMs(q = this.room.questions[this.room.index]) {
    return q && q.clues ? q.clues.length * CLUE_SECONDS * 1000 : this.room.settings.time * 1000;
  }

  answer(p, choice) {
    const room = this.room;
    if (room.phase !== 'question' || p.answer !== null || ![0, 1, 2, 3].includes(choice)) return;
    const q = room.questions[room.index];
    const durationMs = this.durationMs(q);
    const elapsed = Date.now() - room.questionStart;
    if (elapsed > durationMs + 500) return;
    p.answer = choice;
    p.lastCorrect = choice === q.correct;
    if (q.clues) {
      // På spåret: 1000 poäng på första ledtråden, sedan 800, 600, 400, 200.
      const shown = Math.min(Math.floor(elapsed / (CLUE_SECONDS * 1000)), q.clues.length - 1);
      p.lastGain = p.lastCorrect ? (q.clues.length - shown) * 200 : 0;
    } else {
      // Rätt svar ger 500 poäng + upp till 500 bonus för snabbhet.
      p.lastGain = p.lastCorrect ? 500 + Math.round(500 * Math.max(0, 1 - elapsed / durationMs)) : 0;
    }
    p.score += p.lastGain;
    // Rätt svar visas först när tiden är ute, även om alla redan har svarat.
    this.broadcast();
  }

  reveal() {
    const room = this.room;
    if (room.phase !== 'question') return;
    clearTimeout(this.timer);
    for (const p of room.players.values()) if (p.answer === null) p.lastCorrect = false;
    // Spara frågan med rätt svar för genomgången efter spelet.
    const q = room.questions[room.index];
    const players = [...room.players.values()];
    room.history = room.history || [];
    room.history.push({
      number: room.index + 1,
      text: q.text,
      answer: q.options[q.correct],
      song: q.song ? `${q.song.artist} – ${q.song.title}` : null,
      right: players.filter((p) => p.lastCorrect).length,
      total: players.length,
      results: Object.fromEntries(players.map((p) => [p.id, p.lastCorrect])),
    });
    room.phase = 'reveal';
    room.revealEndsAt = Date.now() + REVEAL_SECONDS * 1000;
    this.timer = setTimeout(() => this.startQuestion(), REVEAL_SECONDS * 1000);
    this.broadcast();
  }

  next() {
    if (this.room.phase === 'reveal') this.startQuestion();
  }

  // Avsluta spelet i förtid och visa slutresultatet med poängen hittills.
  end() {
    const room = this.room;
    if (room.phase !== 'question' && room.phase !== 'reveal') return;
    clearTimeout(this.timer);
    room.phase = 'final';
    this.broadcast();
  }

  restart() {
    const room = this.room;
    clearTimeout(this.timer);
    room.phase = 'lobby';
    room.index = -1;
    room.questions = [];
    room.history = [];
    for (const [id, p] of room.players) {
      if (!p.connected) room.players.delete(id);
      else Object.assign(p, { score: 0, answer: null, lastGain: 0, lastCorrect: null });
    }
    this.ensureLeader();
    this.broadcast();
  }

  leave(p) {
    this.room.players.delete(p.id);
    if (p.conn) {
      p.conn.dropped = true;
      setTimeout(() => p.conn?.close(), 200);
    }
    this.ensureLeader();
    this.broadcast();
  }

  // ---------- Tillstånd ----------

  publicState() {
    const room = this.room;
    const q = room.questions[room.index];
    const players = [...room.players.values()];
    const state = {
      code: room.code,
      status: this.status,
      phase: room.phase,
      settings: room.settings,
      leaderId: room.leaderId,
      loading: !!room.loading,
      error: room.error || null,
      categories: categoryInfo(room.settings.level),
      players: players
        .map((p) => ({
          id: p.id,
          name: p.name,
          score: p.score,
          connected: p.connected,
          answered: p.answer !== null,
          lastGain: p.lastGain,
          lastCorrect: p.lastCorrect,
        }))
        .sort((a, b) => b.score - a.score),
      revealSeconds: REVEAL_SECONDS,
    };
    if (room.phase === 'final') state.history = room.history || [];
    if (q && room.phase !== 'lobby') {
      state.question = {
        number: room.index + 1,
        total: room.questions.length,
        text: q.text,
        options: q.options,
        category: CATEGORIES[q.cat],
        duration: this.durationMs(q) / 1000,
        hasAudio: !!q.song,
        level: q.level,
        remainingMs: Math.max(0, room.questionStart + this.durationMs(q) - Date.now()),
      };
      if (q.clues) {
        // Ledtrådarnas text visas på TV:n; telefonerna behöver bara antal och takt.
        state.question.clueCount = q.clues.length;
        state.question.clueSeconds = CLUE_SECONDS;
      }
      if (room.phase !== 'question') {
        // Rätt svar skickas först när frågan är avslutad.
        state.question.correct = q.correct;
        state.question.counts = q.options.map((_, i) => players.filter((p) => p.answer === i).length);
        state.remainingRevealMs = Math.max(0, room.revealEndsAt - Date.now());
        if (q.song) state.question.song = { artist: q.song.artist, title: q.song.title, artwork: q.song.artwork };
      }
    }
    return state;
  }

  broadcast() {
    const state = this.publicState();
    for (const p of this.room.players.values()) this.send(p.conn, { t: 'state', state });
    this.onChange(state);
    this.save();
  }

  // Spelet sparas så att det överlever en omladdning av TV-sidan.
  save() {
    const players = [...this.room.players.values()].map(({ conn, ...p }) => p);
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...this.room, players }));
    } catch {}
  }

  load() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY));
      if (!saved) return null;
      saved.loading = false;
      saved.settings.level = saved.settings.level || 0;
      saved.players = new Map(saved.players.map((p) => [p.id, { ...p, connected: false, conn: null }]));
      return saved;
    } catch {
      return null;
    }
  }

  resumeTimers() {
    const room = this.room;
    if (room.phase === 'question') {
      const left = room.questionStart + this.durationMs() - Date.now();
      this.timer = setTimeout(() => this.reveal(), Math.max(0, left) + 300);
    } else if (room.phase === 'reveal') {
      this.timer = setTimeout(() => this.startQuestion(), Math.max(0, room.revealEndsAt - Date.now()));
    }
  }
}
