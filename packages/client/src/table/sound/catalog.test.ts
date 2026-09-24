import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SOUND_FILES, CATEGORY_SAMPLE, SOUNDS } from './catalog';
import { SOUND_CATEGORIES } from './soundStore';

const PUBLIC = path.resolve(import.meta.dirname, '../../../public');

describe('sound catalog', () => {
  it('points at files that exist in public/audio', () => {
    for (const f of ALL_SOUND_FILES) {
      const file = path.join(PUBLIC, f);
      expect(existsSync(file), f).toBe(true);
      // A real RIFF/WAVE file, not an empty placeholder.
      const head = readFileSync(file).subarray(0, 12).toString('latin1');
      expect(head.startsWith('RIFF') && head.endsWith('WAVE'), f).toBe(true);
    }
  });

  it('references every audio file in public/audio (no stale clips shipped)', () => {
    const listed = new Set(ALL_SOUND_FILES);
    const onDisk = readdirSync(path.join(PUBLIC, 'audio')).filter((f) => /.(wav|mp3|ogg)$/i.test(f));
    expect(onDisk.filter((f) => !listed.has(`/audio/${f}`))).toEqual([]);
  });

  it('puts every sound in a known group and has a sample for each group', () => {
    for (const def of Object.values(SOUNDS)) expect(SOUND_CATEGORIES).toContain(def.category);
    for (const c of SOUND_CATEGORIES) expect(SOUNDS[CATEGORY_SAMPLE[c]].category).toBe(c);
  });
});
