import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ACHIEVEMENTS, CAREER_CHALLENGES, FEATS, RARITY_ORDER } from '@poker/shared';
import { Emblem, emblemName } from './Emblem';
import { EMBLEM_GLYPHS } from './emblemGlyphs';
import { TrophyShelf } from './TrophyShelf';

describe('EMBLEM_GLYPHS', () => {
  it('has an icon for every glyph the catalog uses', () => {
    for (const a of ACHIEVEMENTS) expect(typeof EMBLEM_GLYPHS[a.glyph], a.glyph).toBe('function');
  });
});

describe('Emblem', () => {
  it('draws every career emblem locked and at every tier, named for its metal', () => {
    for (const def of CAREER_CHALLENGES) {
      for (const tier of [0, 1, 2, 3, 4, 5]) {
        const { container, unmount } = render(<Emblem achievementId={def.id} tier={tier} size={48} />);
        const svg = container.querySelector('svg[data-emblem]')!;
        expect(svg).toHaveAttribute('data-tier', String(tier));
        expect(svg).toHaveAttribute('aria-label', emblemName(def, tier));
        // The glyph is a nested icon svg.
        expect(svg.querySelector('svg'), `${def.id} ${tier}`).not.toBeNull();
        unmount();
      }
    }
    render(<Emblem achievementId="grinder" tier={3} />);
    expect(screen.getByRole('img', { name: 'Grinder III, gold' })).toBeInTheDocument();
    render(<Emblem achievementId="grinder" tier={0} />);
    expect(screen.getByRole('img', { name: 'Grinder, locked' })).toBeInTheDocument();
  });

  it('draws every feat unlocked and locked; secret feats show "?" until unlocked', () => {
    for (const def of FEATS) {
      const unlocked = render(<Emblem achievementId={def.id} tier={1} />);
      expect(unlocked.container.querySelector('svg[data-emblem] svg'), def.id).not.toBeNull();
      expect(unlocked.container.querySelector('svg[data-emblem]')).toHaveAttribute('aria-label', emblemName(def, 1));
      unlocked.unmount();
      const locked = render(<Emblem achievementId={def.id} tier={0} />);
      const svg = locked.container.querySelector('svg[data-emblem]')!;
      if (def.secret) {
        expect(svg.querySelector('svg')).toBeNull();
        expect(svg.querySelector('text')).toHaveTextContent('?');
        expect(svg).toHaveAttribute('aria-label', 'Secret feat, locked');
      } else {
        expect(svg.querySelector('svg')).not.toBeNull();
      }
      locked.unmount();
    }
  });

  it('names feats by rarity, and only legendary ones carry the shine', () => {
    for (const rarity of RARITY_ORDER) {
      const def = FEATS.find((f) => f.rarity === rarity)!;
      const { container, unmount } = render(<Emblem achievementId={def.id} tier={1} />);
      expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe(`${def.name}, ${rarity} feat`);
      expect(!!container.querySelector('.motion-safe\\:animate-emblem-shine')).toBe(rarity === 'legendary');
      unmount();
    }
  });

  it('gives each instance its own gradient ids', () => {
    const { container } = render(<><Emblem achievementId="pot-taker" tier={5} /><Emblem achievementId="pot-taker" tier={5} /></>);
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hides from assistive tech when decorative, and renders nothing for an unknown id', () => {
    const { container } = render(<><Emblem achievementId="royalty" tier={1} decorative /><Emblem achievementId="nope" tier={1} /></>);
    expect(container.querySelectorAll('svg[data-emblem]')).toHaveLength(1);
    expect(container.querySelector('svg[data-emblem]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('TrophyShelf', () => {
  it('stands emblems on plaques and fills the rest of the five places', () => {
    render(<TrophyShelf label="Showcase" items={[{ id: 'royalty', tier: 1 }, { id: 'grinder', tier: 3 }]} />);
    const places = screen.getByRole('list', { name: 'Showcase' }).querySelectorAll('li');
    expect(places).toHaveLength(5);
    expect(places[0]).toHaveTextContent('Royalty, legendary feat');
    expect(places[1]).toHaveTextContent('Grinder III, gold');
    expect(places[4]).toHaveTextContent('Empty place');
  });
});
