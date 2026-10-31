// Bakgrundsmusik som skapas direkt i webbläsaren (Web Audio) – inga ljudfiler, ingen upphovsrätt.
// En enkel slinga: bas, arpeggio och hi-hat över ackorden C–G–Am–F.

const BG_TEMPO = 112; // slag per minut
const BG_CHORDS = [
  [48, 52, 55, 60], // C
  [43, 47, 50, 55], // G
  [45, 48, 52, 57], // Am
  [41, 45, 48, 53], // F
];
const BG_ARP = [0, 1, 2, 3, 2, 1, 2, 3]; // ordning för ackordtonerna, åttondelar

class BackgroundMusic {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    // Kort brusbuffert till hi-hatten.
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // Anropas vid ett knapptryck, så att webbläsaren tillåter ljud.
  unlock() {
    this.init();
    this.ctx?.resume();
  }

  setPlaying(on) {
    if (!this.ctx || on === this.playing) return;
    this.playing = on;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(on ? 0.13 : 0, now + 0.6);
    if (on) {
      this.ctx.resume();
      clearTimeout(this.stopTimer);
      if (!this.timer) {
        this.nextTime = now + 0.1;
        this.timer = setInterval(() => this.schedule(), 25);
      }
    } else {
      // Låt tonen tona ut innan schemaläggningen stoppas.
      this.stopTimer = setTimeout(() => {
        clearInterval(this.timer);
        this.timer = null;
      }, 700);
    }
  }

  schedule() {
    const eighth = 60 / BG_TEMPO / 2;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      const bar = Math.floor(this.step / 8) % BG_CHORDS.length;
      const pos = this.step % 8;
      const chord = BG_CHORDS[bar];
      if (pos % 2 === 0) this.tone(chord[0] - 12, this.nextTime, eighth * 1.8, 'triangle', 0.55);
      this.tone(chord[BG_ARP[pos]] + 12, this.nextTime, eighth * 0.9, 'square', 0.12);
      if (pos % 2 === 1) this.hat(this.nextTime);
      this.nextTime += eighth;
      this.step++;
    }
  }

  tone(midi, time, length, type, volume) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + length + 0.05);
  }

  hat(time) {
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    src.buffer = this.noise;
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(time);
  }
}
