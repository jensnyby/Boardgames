const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { CATEGORIES, QUESTIONS } = require('./questions');

const PORT = process.env.PORT || 3000;
const REVEAL_SECONDS = 12; // hur länge rätt svar + ställning visas innan nästa fråga
const TIME_OPTIONS = [10, 15, 20, 30];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/spela', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));

app.get('/qr.svg', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#002f6c', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
});

// IP-adresser i det lokala nätverket, så att TV:n kan visa rätt adress till telefonerna.
app.get('/api/info', (req, res) => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  res.json({ ips, port: PORT, categories: categoryInfo() });
});

function categoryInfo() {
  const cats = Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c, count: QUESTIONS[id].length }));
  const total = cats.reduce((s, c) => s + c.count, 0);
  return [...cats, { id: 'blandat', name: 'Blandat', icon: '🎲', count: total }];
}

function maxQuestions(category) {
  return categoryInfo().find((c) => c.id === category)?.count || 0;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions(category, count) {
  let picked;
  if (category === 'blandat') {
    // Turvis ur varje kategori så att blandningen blir jämn.
    const pools = Object.keys(QUESTIONS).map((id) => shuffle(QUESTIONS[id]).map((q) => ({ ...q, cat: id })));
    picked = [];
    for (let i = 0; picked.length < count; i++) {
      for (const pool of shuffle(pools)) {
        if (pool[i] && picked.length < count) picked.push(pool[i]);
      }
    }
    picked = shuffle(picked);
  } else {
    picked = shuffle(QUESTIONS[category]).slice(0, count).map((q) => ({ ...q, cat: category }));
  }
  return picked.map((q) => {
    const options = shuffle([q.a, ...q.w]);
    return { text: q.q, options, correct: options.indexOf(q.a), cat: q.cat };
  });
}

// ---------- Rum ----------

const rooms = new Map();

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: newCode(),
    players: new Map(),
    leaderId: null,
    settings: { category: 'blandat', count: 10, time: 20 },
    phase: 'lobby', // lobby | question | reveal | final
    questions: [],
    index: -1,
    questionStart: 0,
    timer: null,
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function ensureLeader(room) {
  const leader = room.players.get(room.leaderId);
  if (leader && leader.connected) return;
  const next = connectedPlayers(room)[0];
  room.leaderId = next ? next.id : null;
}

function publicState(room) {
  const q = room.questions[room.index];
  const state = {
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    leaderId: room.leaderId,
    categories: categoryInfo(),
    players: [...room.players.values()]
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
  if (q && room.phase !== 'lobby') {
    state.question = {
      number: room.index + 1,
      total: room.questions.length,
      text: q.text,
      options: q.options,
      category: CATEGORIES[q.cat],
      duration: room.settings.time,
      remainingMs: Math.max(0, room.questionStart + room.settings.time * 1000 - Date.now()),
    };
    if (room.phase !== 'question') {
      state.question.correct = q.correct;
      state.question.counts = q.options.map((_, i) => [...room.players.values()].filter((p) => p.answer === i).length);
      state.remainingRevealMs = Math.max(0, room.revealEndsAt - Date.now());
    }
  }
  return state;
}

function broadcast(room) {
  room.lastActive = Date.now();
  io.to(room.code).emit('state', publicState(room));
}

function startQuestion(room) {
  clearTimeout(room.timer);
  room.index++;
  if (room.index >= room.questions.length) {
    room.phase = 'final';
    broadcast(room);
    return;
  }
  for (const p of room.players.values()) {
    p.answer = null;
    p.lastGain = 0;
    p.lastCorrect = null;
  }
  room.phase = 'question';
  room.questionStart = Date.now();
  room.timer = setTimeout(() => reveal(room), room.settings.time * 1000 + 300);
  broadcast(room);
}

function reveal(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.timer);
  for (const p of room.players.values()) {
    if (p.answer === null) p.lastCorrect = false;
  }
  room.phase = 'reveal';
  room.revealEndsAt = Date.now() + REVEAL_SECONDS * 1000;
  room.timer = setTimeout(() => startQuestion(room), REVEAL_SECONDS * 1000);
  broadcast(room);
}

function resetToLobby(room) {
  clearTimeout(room.timer);
  room.phase = 'lobby';
  room.index = -1;
  room.questions = [];
  for (const [id, p] of room.players) {
    if (!p.connected) room.players.delete(id);
    else Object.assign(p, { score: 0, answer: null, lastGain: 0, lastCorrect: null });
  }
  ensureLeader(room);
  broadcast(room);
}

// ---------- Socket-händelser ----------

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;
  let isTv = false;

  const isController = () => isTv || (room && playerId && room.leaderId === playerId);

  socket.on('tv:open', ({ code } = {}, ack) => {
    room = (code && rooms.get(String(code).toUpperCase())) || createRoom();
    isTv = true;
    socket.join(room.code);
    ack?.({ code: room.code });
    broadcast(room);
  });

  socket.on('player:join', ({ code, name, id } = {}, ack) => {
    const r = rooms.get(String(code || '').trim().toUpperCase());
    if (!r) return ack?.({ error: 'Hittar inget spel med den koden.' });
    const cleanName = String(name || '').trim().slice(0, 16);
    let p = id && r.players.get(id);
    if (!p) {
      if (!cleanName) return ack?.({ error: 'Skriv ditt namn.' });
      const taken = [...r.players.values()].some((o) => o.name.toLowerCase() === cleanName.toLowerCase());
      if (taken) return ack?.({ error: 'Namnet är redan taget.' });
      if (r.players.size >= 30) return ack?.({ error: 'Spelet är fullt.' });
      p = {
        id: Math.random().toString(36).slice(2, 10),
        name: cleanName,
        score: 0,
        answer: null,
        lastGain: 0,
        lastCorrect: null,
      };
      r.players.set(p.id, p);
    }
    p.connected = true;
    p.socketId = socket.id;
    room = r;
    playerId = p.id;
    socket.join(r.code);
    ensureLeader(r);
    ack?.({ id: p.id, name: p.name, code: r.code });
    broadcast(r);
  });

  socket.on('settings', (s = {}) => {
    if (!room || room.phase !== 'lobby' || !isController()) return;
    const cat = categoryInfo().find((c) => c.id === s.category);
    if (cat) room.settings.category = cat.id;
    if (TIME_OPTIONS.includes(s.time)) room.settings.time = s.time;
    const max = maxQuestions(room.settings.category);
    const count = Number.isInteger(s.count) ? s.count : room.settings.count;
    room.settings.count = Math.max(1, Math.min(max, count));
    broadcast(room);
  });

  socket.on('start', () => {
    if (!room || room.phase !== 'lobby' || !isController()) return;
    if (connectedPlayers(room).length === 0) return;
    room.questions = pickQuestions(room.settings.category, room.settings.count);
    room.index = -1;
    startQuestion(room);
  });

  socket.on('answer', (choice) => {
    if (!room || room.phase !== 'question' || !playerId) return;
    const p = room.players.get(playerId);
    if (!p || p.answer !== null || ![0, 1, 2, 3].includes(choice)) return;
    const q = room.questions[room.index];
    const durationMs = room.settings.time * 1000;
    const elapsed = Date.now() - room.questionStart;
    if (elapsed > durationMs + 500) return;
    p.answer = choice;
    p.lastCorrect = choice === q.correct;
    // Rätt svar ger 500 poäng + upp till 500 bonus för snabbhet.
    p.lastGain = p.lastCorrect ? 500 + Math.round(500 * Math.max(0, 1 - elapsed / durationMs)) : 0;
    p.score += p.lastGain;
    if (connectedPlayers(room).every((o) => o.answer !== null)) reveal(room);
    else broadcast(room);
  });

  socket.on('next', () => {
    if (!room || !isController()) return;
    if (room.phase === 'reveal') startQuestion(room);
    else if (room.phase === 'question') reveal(room);
  });

  socket.on('restart', () => {
    if (!room || !isController()) return;
    resetToLobby(room);
  });

  socket.on('leave', () => {
    if (!room || !playerId) return;
    room.players.delete(playerId);
    socket.leave(room.code);
    ensureLeader(room);
    broadcast(room);
    playerId = null;
  });

  socket.on('disconnect', () => {
    if (!room || !playerId) return;
    const p = room.players.get(playerId);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    if (room.phase === 'lobby') room.players.delete(playerId);
    ensureLeader(room);
    if (room.phase === 'question' && connectedPlayers(room).length && connectedPlayers(room).every((o) => o.answer !== null)) {
      reveal(room);
    } else {
      broadcast(room);
    }
  });
});

// Städa bort gamla rum efter 6 timmar utan aktivitet.
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, r] of rooms) {
    if (r.lastActive < cutoff) {
      clearTimeout(r.timer);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
  console.log('\n🇫🇮  Finland-quizet är igång!\n');
  console.log(`   Öppna på TV:n:  http://${ips[0]?.address || 'localhost'}:${PORT}`);
  for (const n of ips.slice(1)) console.log(`                   http://${n.address}:${PORT}`);
  console.log('\n   Telefonerna går med genom att skanna QR-koden på TV:n.\n');
});
