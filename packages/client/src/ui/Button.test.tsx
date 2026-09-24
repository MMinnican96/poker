import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, IconButton } from './Button';

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Take a seat</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Take a seat' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('defaults to type="button" so it never submits forms by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('is disabled and busy while loading, and shows a spinner', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Open the table</Button>);
    const button = screen.getByRole('button', { name: /open the table/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Working' })).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies variant styling', () => {
    const { rerender } = render(<Button variant="primary">A</Button>);
    expect(screen.getByRole('button').className).toContain('bg-chip');
    rerender(<Button variant="brass">A</Button>);
    expect(screen.getByRole('button').className).toContain('bg-brass');
  });
});

describe('IconButton', () => {
  it('uses its label as the accessible name', () => {
    render(<IconButton label="Close"><svg /></IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('reports pressed state', () => {
    render(<IconButton label="Mute" pressed><svg /></IconButton>);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
  });
});
