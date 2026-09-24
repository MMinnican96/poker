import type { AppState } from '../../app/store';
import type { SoundName } from './catalog';

/**
 * Sounds for things that happen outside the felt (pure): a pop for a chat or
 * direct message someone else sent, a chime for good news (level up,
 * challenge complete, a reward claimed). History loading in is quiet: only a
 * single message arriving at the end of a channel counts.
 */
export function appCues(prev: AppState, next: AppState): SoundName[] {
  const out: SoundName[] = [];

  if (next.notices !== prev.notices) {
    const seen = new Set(prev.notices.map((n) => n.id));
    if (next.notices.some((n) => !seen.has(n.id) && n.tone === 'good')) out.push('achievement');
  }

  if (next.chat !== prev.chat) {
    for (const [channel, list] of Object.entries(next.chat)) {
      const before = prev.chat[channel];
      if (list === before || list.length === 0) continue;
      if (next.chatLoaded[channel] && !prev.chatLoaded[channel]) continue;
      const known = new Set((before ?? []).map((m) => m.id));
      const fresh = list.filter((m) => !known.has(m.id));
      const last = list[list.length - 1];
      if (fresh.length === 1 && fresh[0] === last && last.senderId !== next.me.id) {
        out.push('message');
        break;
      }
    }
  }

  return out;
}
