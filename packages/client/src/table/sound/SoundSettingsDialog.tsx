import { useId } from 'react';
import { Button, IconButton, Modal, Slider, Switch } from '../../ui';
import { PlayIcon, SoundOffIcon, SoundOnIcon } from '../icons';
import { CATEGORY_SAMPLE } from './catalog';
import type { SoundManager } from './SoundManager';
import { CATEGORY_LABEL, SOUND_CATEGORIES, useSoundSettings, type SoundCategory } from './soundStore';
import { TICK_FROM_SECONDS } from './turnTicks';
import { appSoundManager } from './useSoundManager';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Mute plus the overall volume slider: the quick controls in the table menu and this dialog. */
export function QuickSoundControls({ className }: { className?: string }) {
  const sound = useSoundSettings();
  return (
    <div className={className ?? 'flex items-center gap-3'}>
      <IconButton label="Mute all sound" pressed={sound.muted} variant="ghost" size="sm" onClick={() => sound.setMuted(!sound.muted)}>
        {sound.muted ? <SoundOffIcon size={18} /> : <SoundOnIcon size={18} />}
      </IconButton>
      <Slider
        value={Math.round(sound.master * 100)}
        onChange={(v) => {
          sound.setMaster(v / 100);
          if (sound.muted && v > 0) sound.setMuted(false);
        }}
        min={0}
        max={100}
        step={5}
        label="Volume"
        valueText={(v) => `${v}%`}
        className="flex-1"
      />
      <span className="tabular w-10 shrink-0 text-right text-[13px] text-stock-dim" aria-hidden="true">
        {sound.muted ? 'Off' : pct(sound.master)}
      </span>
    </div>
  );
}

function CategoryRow({ category, manager, muted }: { category: SoundCategory; manager: SoundManager; muted: boolean }) {
  const sound = useSoundSettings();
  const labelId = useId();
  const value = sound.categories[category];
  const label = CATEGORY_LABEL[category];
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex items-baseline justify-between gap-2">
        <span id={labelId} className="text-sm font-semibold text-stock-dim">{label}</span>
        <span className="tabular text-[13px] text-stock-dim">{pct(value)}</span>
      </span>
      <div className="flex items-center gap-2">
        <Slider
          value={Math.round(value * 100)}
          onChange={(v) => sound.setCategoryVolume(category, v / 100)}
          min={0}
          max={100}
          step={5}
          labelledBy={labelId}
          valueText={(v) => `${v}%`}
          className="flex-1"
        />
        <IconButton
          label={`Play a sample: ${label.toLowerCase()}`}
          size="sm"
          variant="ghost"
          disabled={muted || value <= 0 || sound.master <= 0}
          onClick={() => {
            manager.unlock();
            manager.play(CATEGORY_SAMPLE[category], { requested: true });
          }}
        >
          <PlayIcon size={16} />
        </IconButton>
      </div>
    </li>
  );
}

export interface SoundSettingsDialogProps {
  open: boolean;
  onClose(): void;
  manager?: SoundManager;
}

/** Every sound setting: mute, overall volume, a volume per kind of sound with a sample, and the turn timer ticks. */
export function SoundSettingsDialog({ open, onClose, manager = appSoundManager() }: SoundSettingsDialogProps) {
  const sound = useSoundSettings();
  const ticksLabel = useId();
  const ticksHint = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sound settings"
      size="sm"
      footer={
        <>
          <Button variant="quiet" size="sm" onClick={sound.reset}>Reset to defaults</Button>
          <Button size="sm" onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* The status region stays mounted so screen readers hear it change. */}
        <div role="status">
          {sound.muted && (
            <div className="flex items-center gap-3 rounded-lg bg-chip-dark/25 px-3 py-2 ring-1 ring-chip/50">
              <SoundOffIcon size={18} className="shrink-0 text-stock" />
              <p className="min-w-0 flex-1 text-[14px] text-stock">All sound is muted.</p>
              <Button size="sm" variant="ghost" onClick={() => sound.setMuted(false)}>Turn sound on</Button>
            </div>
          )}
        </div>
        <section>
          <h3 className="mb-1 font-ui text-[13px] font-semibold text-muted">Overall volume</h3>
          <QuickSoundControls />
        </section>
        <section>
          <h3 className="mb-2 font-ui text-[13px] font-semibold text-muted">Each kind of sound</h3>
          <ul className="flex flex-col gap-3">
            {SOUND_CATEGORIES.map((c) => (
              <CategoryRow key={c} category={c} manager={manager} muted={sound.muted} />
            ))}
          </ul>
        </section>
        <div className="flex items-start justify-between gap-3 border-t border-walnut-600/60 pt-3">
          <div className="min-w-0">
            <p id={ticksLabel} className="text-sm font-semibold text-stock">Timer ticks</p>
            <p id={ticksHint} className="text-[13px] text-muted">A clock ticks in the last {TICK_FROM_SECONDS} seconds of your turn.</p>
          </div>
          <Switch checked={sound.timerTicks} onChange={sound.setTimerTicks} labelledBy={ticksLabel} describedBy={ticksHint} />
        </div>
      </div>
    </Modal>
  );
}
