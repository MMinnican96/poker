import Phaser from 'phaser';
import { TableScene } from './TableScene';
import type { GameBridge } from './bridge';

/** Boot a Phaser game mounted in `parent`, wired to the shared bridge. */
export function createGame(parent: HTMLElement, bridge: GameBridge): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 900,
    height: 620,
    backgroundColor: '#14182f',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [TableScene],
  });
  game.registry.set('bridge', bridge);
  return game;
}
