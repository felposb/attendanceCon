// "Toques" de orientação: voz em português, vibração e bipes direcionais.
// O bipe sai pelo lado (estéreo) para onde a pessoa deve virar e fica mais agudo para cima.

export class Feedback {
  constructor({ voice = true, haptics = true } = {}) {
    this.voice = voice;
    this.haptics = haptics;
    this.audio = null;
    this.ptVoice = null;
    this.lastSpoken = { key: null, at: 0 };
    this.lastNudge = 0;
  }

  // Precisa ser chamado dentro de um clique (política de autoplay dos navegadores).
  unlock() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !this.audio) this.audio = new Ctx();
      this.audio?.resume?.();
    } catch { this.audio = null; }
    if ('speechSynthesis' in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        this.ptVoice = voices.find((v) => v.lang === 'pt-BR') || voices.find((v) => v.lang?.startsWith('pt')) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
      // Fala vazia "destrava" a síntese de voz no iOS.
      const u = new SpeechSynthesisUtterance('');
      speechSynthesis.speak(u);
    }
  }

  say(key, text, { force = false } = {}) {
    if (!this.voice || !('speechSynthesis' in window)) return;
    const now = performance.now();
    const same = this.lastSpoken.key === key;
    if (!force && ((same && now - this.lastSpoken.at < 6000) || (!same && now - this.lastSpoken.at < 1800))) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    if (this.ptVoice) u.voice = this.ptVoice;
    u.rate = 1.05;
    speechSynthesis.speak(u);
    this.lastSpoken = { key, at: now };
  }

  vibrate(pattern) {
    if (this.haptics && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* sem suporte */ }
    }
  }

  tone(freq, duration = 0.09, pan = 0, gain = 0.12) {
    if (!this.haptics || !this.audio) return;
    const ctx = this.audio;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    let node = osc.connect(amp);
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(panner);
    }
    node.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // Toque de direção: dir em coordenadas de tela (x para a direita, y para baixo).
  nudge(dir) {
    const now = performance.now();
    if (now - this.lastNudge < 1400) return;
    this.lastNudge = now;
    this.vibrate(Math.abs(dir.x) >= Math.abs(dir.y) ? [35] : [18, 60, 18]);
    this.tone(620 - 200 * dir.y, 0.09, dir.x);
  }

  captured() {
    this.vibrate([45, 35, 45]);
    this.tone(880, 0.08, 0, 0.14);
    setTimeout(() => this.tone(1320, 0.12, 0, 0.12), 90);
  }

  complete() {
    this.vibrate([80, 60, 160]);
    [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 0, 0.13), i * 120));
  }
}
