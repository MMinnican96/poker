import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Modal
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Take a seat"
        description="Pick a seat"
        footer={<button>Confirm</button>}
      >
        <input aria-label="Buy-in" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is a labelled modal dialog and moves focus inside', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const dialog = screen.getByRole('dialog', { name: 'Take a seat' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Pick a seat');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('traps Tab focus inside the dialog', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const close = screen.getByRole('button', { name: 'Close' });
    const input = screen.getByRole('textbox', { name: 'Buy-in' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    close.focus();
    await userEvent.tab();
    expect(input).toHaveFocus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('closes on backdrop click', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const backdrop = screen.getByRole('dialog').previousElementSibling as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('only the innermost modal handles Escape', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal open onClose={outer} title="Outer"><button>a</button></Modal>
        <Modal open onClose={inner} title="Inner"><button>b</button></Modal>
      </>,
    );
    await userEvent.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});
