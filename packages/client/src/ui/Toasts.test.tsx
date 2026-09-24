import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_AFTER_LEAVE_MS, TOAST_HOLD_MAX_MS, TOAST_MS, ToastStack } from './Toasts';

const notice = { id: 'n1', tone: 'info' as const, title: 'Take a seat' };

describe('ToastStack', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sits at the top of the screen, clear of the controls at the bottom', () => {
    render(<ToastStack notices={[notice]} onDismiss={() => {}} />);
    const stack = screen.getByRole('list', { name: 'Notifications' });
    expect(stack.className).toMatch(/\btop-/);
    expect(stack.className).not.toMatch(/\bbottom-/);
  });

  it('draws the art a caller supplies next to the text', () => {
    render(<ToastStack notices={[notice, { ...notice, id: 'n2', title: 'Other' }]} onDismiss={() => {}} renderArt={(n) => (n.id === 'n1' ? <i data-testid="art" /> : null)} />);
    expect(screen.getByTestId('art').closest('li')).toHaveTextContent('Take a seat');
    expect(screen.getAllByTestId('art')).toHaveLength(1);
  });

  it('dismisses itself after its time', () => {
    const onDismiss = vi.fn();
    render(<ToastStack notices={[notice]} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(TOAST_MS.info - 10));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20));
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('holds while hovered, resumes shortly after the pointer leaves', () => {
    const onDismiss = vi.fn();
    render(<ToastStack notices={[notice]} onDismiss={onDismiss} />);
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(TOAST_MS.info + 2000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(TOAST_AFTER_LEAVE_MS - 100));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('never holds a hovered toast forever', () => {
    const onDismiss = vi.fn();
    render(<ToastStack notices={[notice]} onDismiss={onDismiss} />);
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(TOAST_MS.info + TOAST_HOLD_MAX_MS + 300));
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });
});
