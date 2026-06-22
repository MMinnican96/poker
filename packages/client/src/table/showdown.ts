import type { GamePlayer, ShowdownSummary } from '@poker/shared';

/** Human-readable showdown banner, or null when there is no showdown. */
export function showdownBanner(
  showdown: ShowdownSummary | null | undefined,
  players: GamePlayer[],
): string | null {
  if (!showdown || showdown.winnerIds.length === 0) return null;
  const nameOf = (id: string) => players.find((p) => p.discordUserId === id)?.displayName ?? 'Player';
  const names = showdown.winnerIds.map(nameOf);
  const label = showdown.hands[showdown.winnerIds[0]]?.label ?? null;

  if (names.length === 1) {
    return label ? `${names[0]} wins with a ${label}` : `${names[0]} wins the pot`;
  }
  const joined = names.join(' & ');
  return label ? `Split pot — ${joined} · ${label}` : `Split pot — ${joined}`;
}
