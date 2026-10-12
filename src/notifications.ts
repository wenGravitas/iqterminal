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
    mute.onchange = () => { this.settings.muted = mute.checked; this.persist(); }; volume.oninput = () => { this.settings.volume = Number(volume.value)/100; this.persist(); };
    fields.append(enable,field('Master mute',mute),field('Master volume',volume),this.status);
    for (const sound of ['bell','chime','alarm'] as const) { const b = document.createElement('button'); b.textContent = `Preview ${sound}`; b.onclick = () => { this.preview(sound); }; fields.append(b); }
    const footer = document.createElement('footer'), close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => this.dialog.close(); footer.append(close); form.append(header,fields,footer); this.dialog.append(form); document.body.append(this.toasts,this.dialog); this.updateStatus();
  }
  open() { this.updateStatus(); this.dialog.showModal(); }
  async enable() { try { this.audio ??= new AudioContext(); await this.audio.resume(); this.updateStatus(); } catch { this.status.textContent = 'Audio unavailable in this browser. Toasts remain available.'; } }
  private updateStatus() { this.status.textContent = this.audio?.state === 'running' ? 'Audio enabled · rate limit: 2 notifications/s, 1 per rule/s' : 'Audio disabled · use Enable audio to allow sounds'; this.status.textContent += ` · ${this.gate.delivered} accepted / ${this.gate.suppressed} suppressed`; }
  private persist() { try { localStorage.setItem('basis.notifications.v1',JSON.stringify(this.settings)); } catch { this.status.textContent = 'Settings are session-only: storage unavailable.'; } }
  preview(sound: Sound) { this.deliver({ eventId: `preview-${crypto.randomUUID()}`, ruleId: 'preview', owner: 'preview', timeMs: Date.now(), fresh: true, title: 'Sound preview', text: sound, sound, volume: 1, toast: false },true); }
  deliver(r: NotificationRequest, preview = false) {
    if (this.settings.muted || !this.gate.accept(r,Date.now(),document.hidden,preview)) return false;
    if (r.sound !== 'silent') this.play(r.sound,r.volume);
    if (r.toast) this.toast(r.title,r.text);
    return true;
  }
  private play(sound: Exclude<Sound,'silent'>, volume: number) {
    const context = this.audio; if (!context || context.state !== 'running' || this.tones.size >= 12) return;
    const amplitude = Math.max(0,Math.min(1,volume))*this.settings.volume*.06;
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
  diagnostics() { return { ...this.gate.diagnostics(), audio: this.audio?.state ?? 'disabled', voices: this.tones.size, toasts: this.toasts.childElementCount }; }
  dispose() { this.abort.abort(); for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); for (const tone of this.tones) { tone.onended = null; try { tone.stop(); } catch {} tone.disconnect(); } this.tones.clear(); void this.audio?.close(); if(this.dialog.open)this.dialog.close(); this.dialog.remove(); this.toasts.remove(); }
}
