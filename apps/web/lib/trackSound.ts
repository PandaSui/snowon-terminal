"use client";

/** 追踪地址买入提示音。默认开,localStorage `track.sound=off` 关闭。 */

export const TRACK_SOUND_KEY = "track.sound";
export const TRACK_SOUND_EVENT = "track-sound";

export function isTrackSoundOn(): boolean {
  try {
    return localStorage.getItem(TRACK_SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setTrackSound(on: boolean) {
  localStorage.setItem(TRACK_SOUND_KEY, on ? "on" : "off");
  window.dispatchEvent(new Event(TRACK_SOUND_EVENT));
  if (on) {
    unlockTrackSound();
    playTrackBuyChime();
  }
}

let ctx: AudioContext | null = null;

export function unlockTrackSound() {
  try {
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* ignore */
  }
}

/** 两声短叮,买入提醒。浏览器需先有一次用户手势才能出声。 */
export function playTrackBuyChime() {
  if (!isTrackSoundOn()) return;
  try {
    unlockTrackSound();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const beep = (freq: number, start: number, dur: number, gain: number) => {
      const osc = ctx!.createOscillator();
      const g = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0 + start);
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(gain, t0 + start + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(g);
      g.connect(ctx!.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.03);
    };
    beep(880, 0, 0.11, 0.14);
    beep(1318.5, 0.1, 0.18, 0.12);
  } catch {
    /* ignore */
  }
}
