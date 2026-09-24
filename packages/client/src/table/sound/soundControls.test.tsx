import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Header } from '../../lobby/Header';
import { makeTableView, renderWithClient } from '../../test/harness';
import { TableMenu } from '../TableMenu';
import { TopBar } from '../TopBar';
import { getSoundSettings, resetSoundSettings, setMuted } from './soundStore';

const noop = () => undefined;

beforeEach(() => {
  localStorage.clear();
  resetSoundSettings();
});

describe('sound controls around the app', () => {
  it('table menu: quick mute and volume, and "All sound settings" opens the dialog', async () => {
    renderWithClient(<TableMenu open onClose={noop} view={makeTableView()} onTakeSeat={noop} onTopUp={noop} onEditRules={noop} readyCount={0} />);
    const menu = screen.getByRole('dialog', { name: 'Table menu' });
    expect(within(menu).getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('button', { name: 'Mute all sound' }));
    expect(getSoundSettings().muted).toBe(true);
    await userEvent.click(within(menu).getByRole('button', { name: 'All sound settings' }));
    expect(screen.getByRole('dialog', { name: 'Sound settings' })).toBeInTheDocument();
  });

  it("table menu: closing the menu forgets the open sound dialog, so it doesn't come back uninvited", async () => {
    const view = makeTableView();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>Toggle menu</button>
          <TableMenu open={open} onClose={noop} view={view} onTakeSeat={noop} onTopUp={noop} onEditRules={noop} readyCount={0} />
        </>
      );
    }
    renderWithClient(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'All sound settings' }));
    expect(screen.getByRole('dialog', { name: 'Sound settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Toggle menu'));
    expect(screen.queryByRole('dialog', { name: 'Sound settings' })).toBeNull();
    fireEvent.click(screen.getByText('Toggle menu'));
    expect(screen.getByRole('dialog', { name: 'Table menu' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Sound settings' })).toBeNull();
  });

  it('lobby header: the sound button opens the settings and shows when sound is muted', async () => {
    setMuted(true);
    renderWithClient(<Header showRoomButton={false} onOpenRoom={noop} unseenChat={0} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sound settings (muted)' }));
    const dialog = screen.getByRole('dialog', { name: 'Sound settings' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn sound on' }));
    expect(screen.getByRole('button', { name: 'Sound settings' })).toBeInTheDocument();
  });

  it('top bar: one mute toggle with a fixed name and a pressed state', async () => {
    renderWithClient(<TopBar view={makeTableView()} unseenChat={0} onOpenChat={noop} onOpenMenu={noop} />);
    const mute = screen.getByRole('button', { name: 'Mute sounds' });
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(mute);
    expect(getSoundSettings().muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Mute sounds' })).toHaveAttribute('aria-pressed', 'true');
  });
});
