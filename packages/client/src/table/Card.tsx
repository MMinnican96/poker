import type { Card } from '@poker/shared';

const SUIT_SYMBOL: Record<Card['suit'], string> = {
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
};
const RED: Card['suit'][] = ['hearts', 'diamonds'];

const SIZES = {
  sm: 'h-[58px] w-[42px] rounded-[9px] text-[15px]',
  md: 'h-[106px] w-[76px] rounded-xl text-[19px]',
  lg: 'h-[118px] w-[84px] rounded-[15px] text-[24px]',
} as const;

interface Props {
  card: Card | null;
  size?: keyof typeof SIZES;
  rotate?: number;
  reveal?: boolean;
}

export function PlayingCard({ card, size = 'md', rotate = 0, reveal = true }: Props) {
  const faceUp = reveal && card != null;
  const style = rotate ? { transform: `rotate(${rotate}deg)` } : undefined;

  if (!faceUp) {
    return (
      <div
        data-testid="card-back"
        style={style}
        className={`flex items-center justify-center border-2 border-ink bg-gradient-to-br from-felt-400 to-felt-800 text-gold shadow-hard-ink-sm ${SIZES[size]}`}
      >
        ♠
      </div>
    );
  }

  const red = RED.includes(card!.suit);
  return (
    <div
      data-testid="card-face"
      data-red={red}
      style={style}
      className={`relative flex items-center justify-center border-[2.5px] border-ink bg-cream font-display font-bold shadow-card ${SIZES[size]} ${red ? 'text-red-border' : 'text-felt-900'}`}
    >
      <span className="absolute left-2 top-1.5 flex flex-col items-center leading-none">
        <span>{card!.rank}</span>
        <span className="text-[0.8em]">{SUIT_SYMBOL[card!.suit]}</span>
      </span>
      <span className="text-[2.2em] leading-none">{SUIT_SYMBOL[card!.suit]}</span>
    </div>
  );
}
