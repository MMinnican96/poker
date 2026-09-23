import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvatarFrame, CardBack, Felt, PlayingCard, TitleTag, celebrationOptions, owns, ownedOfCategory, titleText } from '.';

describe('cosmetic renderers', () => {
  it('Felt paints the catalog colours and falls back to the house felt', () => {
    const { container, rerender } = render(<Felt feltId="felt-oxblood" />);
    const cloth = container.querySelector('[data-felt]') as HTMLElement;
    expect(cloth.style.backgroundColor).toBe('rgb(110, 26, 31)');
    rerender(<Felt feltId="not-a-felt" />);
    expect((container.querySelector('[data-felt]') as HTMLElement).style.backgroundColor).toBe('rgb(31, 91, 63)');
  });

  it('PlayingCard names the card and shows a back when face down', () => {
    const { rerender } = render(<PlayingCard card={{ rank: 'Q', suit: 'hearts' }} />);
    expect(screen.getByRole('img', { name: 'Queen of hearts' })).toBeInTheDocument();
    rerender(<PlayingCard card={{ rank: '10', suit: 'spades' }} size="xs" />);
    expect(screen.getByRole('img', { name: '10 of spades' })).toBeInTheDocument();
    rerender(<PlayingCard card={null} backId="back-cheese" />);
    expect(screen.getByRole('img', { name: 'Face-down card' })).toBeInTheDocument();
  });

  it('CardBack sizes by width at card proportions', () => {
    const { container } = render(<CardBack backId="back-grid" width={50} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('50');
    expect(svg.getAttribute('height')).toBe('70');
  });

  it('AvatarFrame draws the frame style from the item', () => {
    const { container } = render(<AvatarFrame frameId="frame-chip" size={48}><img alt="" /></AvatarFrame>);
    expect(container.querySelector('[data-frame]')).toHaveAttribute('data-frame', 'chip');
  });

  it('TitleTag accepts text or a title item id and hides empty titles', () => {
    expect(titleText('title-shark')).toBe('Card shark');
    expect(titleText('title-none')).toBeNull();
    expect(titleText('Nit')).toBe('Nit');
    const { container } = render(<TitleTag title={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ownership treats free items as owned', () => {
    expect(owns({}, 'felt-classic')).toBe(true);
    expect(owns({}, 'felt-oxblood')).toBe(false);
    expect(ownedOfCategory({ 'felt-oxblood': 1 }, 'felt').map((i) => i.id)).toEqual(['felt-classic', 'felt-oxblood']);
  });

  it('celebration options carry the item colours', () => {
    expect(celebrationOptions('cele-confetti').colors).toEqual(['#d9a441', '#f3e6c8', '#c8272d']);
    expect(celebrationOptions('cele-confetti').disableForReducedMotion).toBe(true);
  });
});
