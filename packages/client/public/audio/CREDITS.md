# Audio Credits

| File | Description | Source / License |
|---|---|---|
| bet.mp3 | Chips bet/raise | Project-supplied |
| check.mp3 | Knock (check) | Project-supplied |
| muck-deal.mp3 | Community cards deal | Project-supplied |
| fold.wav | Card muck (fold) | Synthesized for this project — public domain (CC0) |
| suspense.wav | Tension sting (consecutive raise) | Synthesized for this project — public domain (CC0) |
| win.wav | Win fanfare | Synthesized for this project — public domain (CC0) |

The three `.wav` clips were generated procedurally (see
`.superpowers/sdd/gen-sounds.mjs` in git history) and carry no licensing
restrictions. They are intentionally simple placeholders and can be swapped for
any preferred clips by replacing the files in this folder (update the path in
`packages/client/src/table/sound/SoundManager.ts` if the extension changes).
