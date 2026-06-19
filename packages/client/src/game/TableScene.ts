import Phaser from 'phaser';
import type { Card, GamePlayer, GameState } from '@poker/shared';
import { BRIDGE, type GameBridge, type StatePayload, type TimerPayload } from './bridge';

const WIDTH = 900;
const HEIGHT = 620;
const CX = WIDTH / 2;
const CY = HEIGHT / 2 - 10;
const RX = 360;
const RY = 230;

const SUIT: Record<Card['suit'], { sym: string; color: string }> = {
  hearts: { sym: '♥', color: '#e23b3b' },
  diamonds: { sym: '♦', color: '#e23b3b' },
  clubs: { sym: '♣', color: '#1b1f3b' },
  spades: { sym: '♠', color: '#1b1f3b' },
};

const BETTING_PHASES: GameState['phase'][] = ['pre-flop', 'flop', 'turn', 'river'];

/**
 * Renders the poker table from sanitized game state pushed over the bridge.
 * Cards are drawn procedurally (vector) so there is no external asset
 * dependency; swap in a sprite sheet later by replacing `makeCard`.
 */
export class TableScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private root!: Phaser.GameObjects.Container;
  private last: StatePayload | null = null;
  private lastHandNumber = -1;

  private activePlayerId: string | null = null;
  private activeTimerText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Table');
  }

  create(): void {
    this.bridge = this.registry.get('bridge') as GameBridge;
    this.root = this.add.container(0, 0);

    this.bridge.on(BRIDGE.State, this.onState, this);
    this.bridge.on(BRIDGE.Timer, this.onTimer, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.bridge.off(BRIDGE.State, this.onState, this);
      this.bridge.off(BRIDGE.Timer, this.onTimer, this);
    });

    if (this.last) this.render(this.last);
  }

  private onState = (payload: StatePayload): void => {
    this.last = payload;
    if (this.root) this.render(payload);
  };

  private onTimer = (payload: TimerPayload): void => {
    if (this.activeTimerText && payload.playerId === this.activePlayerId) {
      this.activeTimerText.setText(`${Math.ceil(payload.remainingMs / 1000)}s`);
    }
  };

  private render({ state, viewerId }: StatePayload): void {
    this.root.removeAll(true);
    this.activeTimerText = null;
    this.activePlayerId = null;

    this.drawFelt();
    this.drawCommunity(state);

    const players = state.players;
    const n = players.length;
    const meIdx = Math.max(0, players.findIndex((p) => p.discordUserId === viewerId));
    const isBetting = BETTING_PHASES.includes(state.phase);
    const newHand = state.handNumber !== this.lastHandNumber;
    this.lastHandNumber = state.handNumber;

    players.forEach((player, i) => {
      if (player.status === 'sitting-out') return;
      const rel = (i - meIdx + n) % n;
      const angle = Phaser.Math.DegToRad(90 + (rel * 360) / n);
      const x = CX + RX * Math.cos(angle);
      const y = CY + RY * Math.sin(angle);
      const isActive = isBetting && i === state.currentPlayerIndex && player.status === 'active';
      this.drawSeat(player, x, y, {
        isMe: i === meIdx,
        isDealer: i === state.dealerIndex,
        isActive,
        animateDeal: newHand,
      });
    });
  }

  private drawFelt(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0d3b24, 1).fillEllipse(CX, CY, RX * 2 + 28, RY * 2 + 28);
    g.fillStyle(0x1f7a4d, 1).fillEllipse(CX, CY, RX * 2, RY * 2);
    g.lineStyle(4, 0x14532d, 1).strokeEllipse(CX, CY, RX * 2, RY * 2);
    this.root.add(g);
  }

  private drawCommunity(state: GameState): void {
    const spacing = 54;
    const startX = CX - spacing * 2;
    for (let i = 0; i < 5; i++) {
      const card = state.communityCards[i];
      const x = startX + i * spacing;
      if (card) {
        const c = this.makeCard(card, true);
        c.setPosition(x, CY - 26);
        this.root.add(c);
        this.popIn(c);
      } else {
        const slot = this.add.graphics();
        slot.lineStyle(2, 0xffffff, 0.12).strokeRoundedRect(x - 23, CY - 59, 46, 66, 6);
        this.root.add(slot);
      }
    }

    const pot = state.pots.reduce((sum, p) => sum + p.amount, 0);
    const potText = this.add
      .text(CX, CY + 34, `Pot: ${pot.toLocaleString()}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#ffe9a8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.root.add(potText);
  }

  private drawSeat(
    player: GamePlayer,
    x: number,
    y: number,
    opts: { isMe: boolean; isDealer: boolean; isActive: boolean; animateDeal: boolean },
  ): void {
    const container = this.add.container(x, y);
    if (player.status === 'folded') container.setAlpha(0.4);

    // Avatar disc with initials.
    const color = colorFromId(player.discordUserId);
    const disc = this.add.graphics();
    disc.fillStyle(color, 1).fillCircle(0, 0, 28);
    disc
      .lineStyle(3, opts.isActive ? 0xffd24a : 0x000000, opts.isActive ? 1 : 0.25)
      .strokeCircle(0, 0, 28);
    const initials = this.add
      .text(0, 0, getInitials(player.displayName), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    container.add([disc, initials]);

    // Name + chip stack.
    const name = this.add
      .text(0, 40, player.displayName, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const chips = this.add
      .text(0, 58, `${player.chipStack.toLocaleString()}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#ffe9a8',
      })
      .setOrigin(0.5);
    container.add([name, chips]);

    if (opts.isDealer) {
      const btn = this.add.graphics();
      btn.fillStyle(0xffffff, 1).fillCircle(30, -24, 11);
      const d = this.add.text(30, -24, 'D', {
        fontFamily: 'system-ui',
        fontSize: '12px',
        color: '#1b1f3b',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add([btn, d]);
    }

    if (player.status === 'all-in') {
      const tag = this.add
        .text(0, -42, 'ALL IN', {
          fontFamily: 'system-ui',
          fontSize: '12px',
          color: '#ff6b6b',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      container.add(tag);
    }

    // Hole cards above the avatar.
    if (player.status !== 'folded') {
      const faceUp = player.holeCards !== null;
      const cards: [Card | null, Card | null] = player.holeCards ?? [null, null];
      [-15, 15].forEach((dx, idx) => {
        const card = this.makeCard(cards[idx], faceUp);
        card.setScale(0.78);
        card.setPosition(dx, -58);
        container.add(card);
        if (opts.animateDeal) {
          card.setPosition(CX - x, CY - y - 58);
          this.tweens.add({ targets: card, x: dx, y: -58, duration: 280, delay: idx * 60, ease: 'Cubic.out' });
        }
      });
    }

    // Active-player highlight + per-turn timer.
    if (opts.isActive) {
      const ring = this.add.graphics();
      ring.lineStyle(3, 0xffd24a, 1).strokeCircle(0, 0, 33);
      container.add(ring);
      this.tweens.add({ targets: ring, alpha: { from: 1, to: 0.25 }, duration: 600, yoyo: true, repeat: -1 });

      const timer = this.add
        .text(0, -82, '', { fontFamily: 'system-ui', fontSize: '13px', color: '#ffd24a', fontStyle: 'bold' })
        .setOrigin(0.5);
      container.add(timer);
      this.activeTimerText = timer;
      this.activePlayerId = player.discordUserId;
    }

    this.root.add(container);

    // Current bet, floating toward the pot.
    if (player.betThisRound > 0) {
      const dirX = (CX - x) * 0.32;
      const dirY = (CY - y) * 0.32;
      const chipDisc = this.add.graphics();
      chipDisc.fillStyle(0xffd24a, 1).fillCircle(x + dirX, y + dirY, 9);
      chipDisc.lineStyle(2, 0xb8860b, 1).strokeCircle(x + dirX, y + dirY, 9);
      const betText = this.add
        .text(x + dirX, y + dirY - 18, `${player.betThisRound}`, {
          fontFamily: 'system-ui',
          fontSize: '12px',
          color: '#ffe9a8',
        })
        .setOrigin(0.5);
      this.root.add([chipDisc, betText]);
    }
  }

  private makeCard(card: Card | null, faceUp: boolean): Phaser.GameObjects.Container {
    const w = 46;
    const h = 66;
    const c = this.add.container(0, 0);
    const g = this.add.graphics();

    if (faceUp && card) {
      g.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 6);
      g.lineStyle(1, 0xcccccc, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
      const suit = SUIT[card.suit];
      const rank = this.add
        .text(-w / 2 + 5, -h / 2 + 3, card.rank, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '15px',
          color: suit.color,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);
      const sym = this.add.text(0, 4, suit.sym, { fontSize: '24px', color: suit.color }).setOrigin(0.5);
      c.add([g, rank, sym]);
    } else {
      g.fillStyle(0x3a4699, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 6);
      g.lineStyle(2, 0x2a3270, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
      const pattern = this.add.graphics();
      pattern.lineStyle(1, 0x6b78d6, 0.5);
      for (let i = -w / 2 + 6; i < w / 2 - 4; i += 7) {
        pattern.lineBetween(i, -h / 2 + 6, i + 6, h / 2 - 6);
      }
      c.add([g, pattern]);
    }
    return c;
  }

  private popIn(obj: Phaser.GameObjects.Container): void {
    obj.setScale(0.6);
    this.tweens.add({ targets: obj, scale: 1, duration: 200, ease: 'Back.out' });
  }
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

function colorFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffff;
  const hue = hash % 360;
  const color = Phaser.Display.Color.HSVToRGB(hue / 360, 0.55, 0.7) as Phaser.Types.Display.ColorObject;
  return Phaser.Display.Color.GetColor(color.r, color.g, color.b);
}
