# Audio credits

Every clip in this folder is synthesized by
`packages/client/scripts/gen-sounds.mjs`, written for this project. No recordings
or third-party samples are used, and the clips are dedicated to the public
domain (CC0): use them for anything.

| Files | Sound |
|---|---|
| `check-1..3.wav` | Two knuckle knocks on the padded rail |
| `call-1..3.wav` | A couple of clay chips set down |
| `bet-1..3.wav` | A short stack placed with a soft thud |
| `raise-1..2.wav` | A stack placed, then more chips tossed on |
| `allin-1..2.wav` | The whole stack shoved across the felt |
| `deal-1..3.wav` | Two quick card flicks (hole cards) |
| `flop-1..2.wav` | The flop slid out and spread |
| `card-1..2.wav` | One card slid out and set down (turn, river) |
| `flip-1..2.wav` | A card turned face up |
| `fold-1..2.wav` | Cards tossed into the muck |
| `turn.wav` | Your turn: two soft mallet notes |
| `tick.wav`, `tick-urgent.wav` | Turn timer ticks |
| `pot-1..2.wav` | The pot pushed to the winner |
| `win.wav` | You won: a warm arpeggio |
| `suspense.wav` | Raise-streak tension sting |
| `achievement.wav` | Level up, challenge complete |
| `message.wav` | A chat message or DM |

## Regenerating

```
npm run sounds:generate -w @poker/client
```

The output is deterministic (seeded per file), 16-bit mono WAV at 32 kHz. The
script prints each clip's duration, peak, RMS, short-term loudness, spectral
centroid and share of energy above 8 kHz, and flags anything that looks wrong.
Loudness targets are set per clip in the script's `CLIPS` table. It also warns
about audio files here that it did not write (it never deletes them: one may be
a recording), and `catalog.test.ts` fails on any file the catalog does not list.

## Swapping in a recording

1. Trim it tight, fade both ends, and export mono 16-bit WAV (`catalog.test.ts`
   expects WAV files).
2. Match its loudness to the clip it replaces: the script's loudness figure is
   the loudest 100 ms window, K-weighted, so aim for the same number (a
   loudness meter's short-term reading gets close).
3. Save it here under the same name, or update the file list for that sound in
   `packages/client/src/table/sound/catalog.ts` (a sound can have any number of
   variants). `catalog.test.ts` checks every listed file exists.
4. Remove the clip from `CLIPS` in the generator so a regenerate doesn't
   overwrite it, and note the source and licence in this file.
