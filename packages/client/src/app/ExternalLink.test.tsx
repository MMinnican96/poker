import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscordSDK } from '@discord/embedded-app-sdk';
import { ClientProvider } from './client';
import { makeClient } from '../test/harness';
import { ExternalLink } from './ExternalLink';

describe('ExternalLink', () => {
  it('is a plain new-tab link outside Discord', () => {
    const { client } = makeClient();
    render(<ClientProvider client={client}><ExternalLink href="https://game-icons.net">game-icons.net</ExternalLink></ClientProvider>);
    const link = screen.getByRole('link', { name: 'game-icons.net' });
    expect(link).toHaveAttribute('href', 'https://game-icons.net');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('opens through the Discord SDK inside the Activity', async () => {
    const openExternalLink = vi.fn(async () => ({ opened: true }));
    const { client } = makeClient();
    client.session = { ...client.session, mode: 'discord', sdk: { commands: { openExternalLink } } as unknown as DiscordSDK };
    const clicks = vi.fn();
    render(
      <div onClick={(e) => clicks(e.defaultPrevented)}>
        <ClientProvider client={client}><ExternalLink href="https://game-icons.net">game-icons.net</ExternalLink></ClientProvider>
      </div>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'game-icons.net' }));
    expect(openExternalLink).toHaveBeenCalledWith({ url: 'https://game-icons.net' });
    // The browser's own navigation is cancelled.
    expect(clicks).toHaveBeenCalledWith(true);
  });
});
