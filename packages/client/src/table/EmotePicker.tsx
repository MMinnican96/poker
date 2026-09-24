import { useRef, useState } from 'react';
import { useCommands } from '../app/client';
import { IconButton, cx } from '../ui';
import { useDismiss, useRun } from './hooks';
import { SmileIcon } from './icons';

/** A button that opens your emotes; picking one floats it up from your seat for everyone. */
export function EmotePicker({ emotes, className }: { emotes: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const commands = useCommands();
  const [run] = useRun();
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(open, panel, () => setOpen(false), button);
  if (emotes.length === 0) return null;
  return (
    <div className={cx('relative', className)}>
      <IconButton ref={button} label="Emotes" variant="ghost" pressed={open} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <SmileIcon size={20} />
      </IconButton>
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label="Send an emote"
          className="absolute bottom-full left-0 z-40 mb-2 grid w-max grid-cols-6 gap-1 rounded-xl bg-walnut-800 p-2 shadow-lift ring-1 ring-walnut-600 tex-wood motion-safe:animate-rise"
        >
          {emotes.map((e) => (
            <button
              key={e}
              type="button"
              role="menuitem"
              aria-label={`Send ${e}`}
              onClick={() => {
                setOpen(false);
                void run('emote', () => commands.emote(e));
              }}
              className="grid size-10 place-items-center rounded-lg text-2xl leading-none transition-transform hover:bg-stock/10 active:scale-90"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
