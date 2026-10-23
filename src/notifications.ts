import type { Sound } from './ticker/model';
export interface NotificationRequest { eventId: string; ruleId: string; owner: string; timeMs: number; fresh: boolean; title: string; text: string; sound: Sound; volume: number; toast: boolean; muted?: boolean }
/** Delivery policy is reusable and has no ticker/row dependencies. */
export class NotificationGate {
  private recent = new Map<string,number>(); private cooldown = new Map<string,number>(); private rates: number[] = [];
  suppressed = 0; delivered = 0;
  accept(r: NotificationRequest, now: number, hidden: boolean, preview = false) {
    if (!preview && (!r.fresh || hidden || now-r.timeMs > 3000 || r.timeMs-now > 1000 || r.muted)) { this.suppressed++; return false; }
    const key = `${r.ruleId}:${r.eventId}`;
    if (!preview && this.recent.has(key)) { this.suppressed++; return false; }
    this.recent.set(key,now); while (this.recent.size > 2048) this.recent.delete(this.recent.keys().next().value!);
    for (const [id,t] of this.recent) if (now-t > 60000) this.recent.delete(id);
    this.rates = this.rates.filter(t => now-t < 1000);
    if (this.rates.length >= 2 || !preview && now-(this.cooldown.get(r.ruleId) ?? -Infinity) < 1000) { this.suppressed++; return false; }
    this.rates.push(now); this.cooldown.set(r.ruleId,now); while (this.cooldown.size > 128) this.cooldown.delete(this.cooldown.keys().next().value!);
    this.delivered++; return true;
  }
  release(owner: string) { for (const id of this.cooldown.keys()) if (id.startsWith(`${owner}:`)) this.cooldown.delete(id); }
  diagnostics() { return { recent: this.recent.size, cooldowns: this.cooldown.size, suppressed: this.suppressed, delivered: this.delivered }; }
}
/** Original oscillator scores bundled as code, no copyrighted sound samples. */
const scores: Record<Exclude<Sound,'silent'>, readonly [number,number,number][]> = {
  bell: [[880,0,.7],[1320,0,.5],[1760,0,.25]],
  chime: [[660,0,.25],[990,.12,.4]],
  alarm: [[660,0,.16],[880,.18,.16],[660,.36,.2]],
};
export class Notifications {
  readonly gate = new NotificationGate(); private audio?: AudioContext;
  private audioMuted = false;
  private audioListeners = new Set<() => void>();
  private tones = new Set<OscillatorNode>(); private timers = new Set<ReturnType<typeof setTimeout>>();
  private toasts = document.createElement('aside'); private dialog = document.createElement('dialog');
  private status = document.createElement('p'); private abort = new AbortController();
  private settings = { version: 1, muted: false, volume: .5 };
  constructor() {
    try { const v = JSON.parse(localStorage.getItem('basis.notifications.v1') ?? 'null'); if (v?.version === 1) this.settings = { version: 1, muted: v.muted === true, volume: typeof v.volume === 'number' && Number.isFinite(v.volume) ? Math.max(0,Math.min(1,v.volume)) : .5 }; } catch { /* session defaults */ }
    this.toasts.className = 'notification-toasts'; this.toasts.setAttribute('aria-label','Notifications'); this.toasts.setAttribute('aria-live','polite');
    this.dialog.className = 'indicator-settings notification-settings'; this.dialog.setAttribute('aria-label','Notifications settings');
    const form = document.createElement('div'); form.className = 'indicator-settings-form';
    const header = document.createElement('header'), title = document.createElement('h2'); title.textContent = 'Notifications'; header.append(title);
    const fields = document.createElement('div'); fields.className = 'indicator-settings-fields';
    const enable = document.createElement('button'); enable.textContent = 'Enable audio'; enable.onclick = () => void this.enable();
    const mute = document.createElement('input'); mute.type = 'checkbox'; mute.checked = this.settings.muted;
    const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.value = String(this.settings.volume*100);
    const field = (name: string, input: HTMLElement) => { const l = document.createElement('label'); l.className = 'indicator-setting-field'; const text = document.createElement('span'); text.textContent = name; l.append(text,input); return l; };
    mute.onchange = () => { this.settings.muted = mute.checked; if (mute.checked) this.stopTones(); this.persist(); this.updateStatus(); }; volume.oninput = () => { this.settings.volume = Number(volume.value)/100; this.persist(); this.updateStatus(); };
    fields.append(enable,field('Master mute',mute),field('Master volume',volume),this.status);
    for (const sound of ['bell','chime','alarm'] as const) { const b = document.createElement('button'); b.textContent = `Preview ${sound}`; b.onclick = () => { this.preview(sound); }; fields.append(b); }
    const footer = document.createElement('footer'), close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => this.dialog.close(); footer.append(close); form.append(header,fields,footer); this.dialog.append(form); document.body.append(this.toasts,this.dialog); this.updateStatus();
  }
  open() { this.updateStatus(); this.dialog.showModal(); }
  audioEnabled() { return this.audio?.state === 'running' && !this.audioMuted && !this.settings.muted && this.settings.volume > 0; }
  subscribeAudio(listener: () => void, signal: AbortSignal) {
    this.audioListeners.add(listener);
    signal.addEventListener('abort', () => this.audioListeners.delete(listener), { once: true });
  }
  async enable() {
    try {
      if (!this.audio || this.audio.state === 'closed') {
        this.audio = new AudioContext();
        this.audio.onstatechange = () => this.updateStatus();
      }
      await this.audio.resume();
      if (this.audio.state !== 'running') { this.updateStatus(); return false; }
      this.audioMuted = false;
      this.settings.muted = false;
      if (this.settings.volume === 0) this.settings.volume = .5;
      this.persist(); this.updateStatus(); return true;
    } catch {
      this.updateStatus();
      this.status.textContent = 'Audio unavailable in this browser. Toasts remain available.';
      return false;
    }
  }
  disable() { this.audioMuted = true; this.stopTones(); this.updateStatus(); }
  private stopTones() {
    for (const tone of this.tones) { tone.disconnect(); try { tone.stop(); } catch { /* Already ended. */ } }
    this.tones.clear();
  }
  private updateStatus() {
    this.status.textContent = this.audioEnabled() ? 'Audio enabled · rate limit: 2 notifications/s, 1 per rule/s' : 'Audio disabled · use Enable audio to allow sounds';
    this.status.textContent += ` · ${this.gate.delivered} accepted / ${this.gate.suppressed} suppressed`;
    const mute = this.dialog.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const volume = this.dialog.querySelector<HTMLInputElement>('input[type="range"]');
    if (mute) mute.checked = this.settings.muted;
    if (volume) volume.value = String(this.settings.volume * 100);
    for (const listener of this.audioListeners) listener();
  }
  private persist() { try { localStorage.setItem('basis.notifications.v1',JSON.stringify(this.settings)); } catch { this.status.textContent = 'Settings are session-only: storage unavailable.'; } }
  async test(request: NotificationRequest) {
    if (request.sound !== 'silent' && request.volume > 0 && !await this.enable()) return 'Audio unavailable · enable sound in your browser and try again';
    // Explicit tests are independent of live notification rate limiting.
    if (request.sound !== 'silent' && request.volume > 0) { this.stopTones(); this.play(request.sound, request.volume); }
    if (request.toast) this.toast(request.title, request.text);
    if (request.sound === 'silent') return 'Silent tier · choose bell, chime or alarm to test audio';
    if (request.volume === 0) return 'Tier volume is 0% · increase it to test audio';
    return 'Sound preview playing';
  }
  preview(sound: Sound) { void this.test({ eventId: `preview-${crypto.randomUUID()}`, ruleId: 'preview', owner: 'preview', timeMs: Date.now(), fresh: true, title: 'Sound preview', text: sound, sound, volume: 1, toast: false }).then(message => { this.status.textContent = message; }); }
  deliver(r: NotificationRequest, preview = false) {
    if (this.settings.muted || !this.gate.accept(r,Date.now(),document.hidden,preview)) return false;
    if (r.sound !== 'silent') this.play(r.sound,r.volume);
    if (r.toast) this.toast(r.title,r.text);
    return true;
  }
  private play(sound: Exclude<Sound,'silent'>, volume: number) {
    const context = this.audio; if (!context || !this.audioEnabled() || this.tones.size >= 12) return;
    // Keep the three simultaneous bell partials below full scale at maximum volume.
    const amplitude = Math.max(0,Math.min(1,volume))*this.settings.volume*.24;
    if (!amplitude) return;
    for (const [frequency,offset,duration] of scores[sound]) {
      const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime+offset;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001,start); gain.gain.exponentialRampToValueAtTime(amplitude,start+.008); gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
      oscillator.connect(gain); gain.connect(context.destination); this.tones.add(oscillator);
      oscillator.onended = () => { this.tones.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start+duration+.02);
    }
  }
  private toast(title: string, text: string) {
    while (this.toasts.childElementCount >= 3) this.toasts.firstElementChild?.remove();
    const card = document.createElement('div'), heading = document.createElement('strong'), body = document.createElement('span'); card.className = 'notification-toast'; heading.textContent = title.slice(0,80); body.textContent = text.slice(0,220); card.append(heading,body); this.toasts.append(card);
    const timer = setTimeout(() => { card.remove(); this.timers.delete(timer); },4000); this.timers.add(timer);
  }
  release(owner: string) { this.gate.release(owner); }
  diagnostics() { return { ...this.gate.diagnostics(), audio: this.audio?.state ?? 'disabled', audioEnabled: this.audioEnabled(), audioMuted: this.audioMuted, muted: this.settings.muted, volume: this.settings.volume, voices: this.tones.size, toasts: this.toasts.childElementCount }; }
  dispose() { this.abort.abort(); this.audioListeners.clear(); if (this.audio) this.audio.onstatechange = null; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); for (const tone of this.tones) { tone.onended = null; try { tone.stop(); } catch {} tone.disconnect(); } this.tones.clear(); void this.audio?.close(); if(this.dialog.open)this.dialog.close(); this.dialog.remove(); this.toasts.remove(); }
}
