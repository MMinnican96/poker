import { useEffect, useRef, useState } from 'react';
import { useCommands } from '../app/client';
import { IconButton, cx } from '../ui';
import { useDismiss, useMenuKeys, useRun } from './hooks';
import { SmileIcon } from './icons';

/** A button that opens your emotes; picking one floats it up from your seat for everyone. */
export function EmotePicker({ emotes, className }: { emotes: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const commands = useCommands();
  const [run] = useRun();
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  useDismiss(open, panel, () => close(panel.current?.contains(document.activeElement) ?? false), button);
  const onKeyDown = useMenuKeys(panel, 6);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  if (emotes.length === 0) return null;
  return (
    <div className={cx('relative', className)}>
      <IconButton ref={button} label="Emotes" variant="ghost" pressed={open} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <SmileIcon size={20} />
      </IconButton>
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label="Send an emote"
          onKeyDown={onKeyDown}
          className="absolute bottom-full left-0 z-40 mb-2 grid w-max grid-cols-6 gap-1 rounded-xl bg-walnut-800 p-2 shadow-lift ring-1 ring-walnut-600 tex-wood motion-safe:animate-rise"
        >
          {emotes.map((e) => (
            <button
              key={e}
              type="button"
              role="menuitem"
              aria-label={`Send ${e}`}
              onClick={() => {
                close(true);
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
