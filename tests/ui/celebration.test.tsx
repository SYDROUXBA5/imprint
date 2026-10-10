import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Celebration } from '../../src/ui/Celebration';

const setVibrate = (fn: unknown) =>
  Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true, writable: true });

afterEach(() => {
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('Celebration', () => {
  it('shows "Rex: MDMA imprinted" and the IMPRINTED stamp', () => {
    render(<Celebration dog="Rex" odour="MDMA" onDone={() => {}} />);
    expect(screen.getByText('Rex: MDMA imprinted')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Imprinted' })).toBeInTheDocument();
  });

  it('is dismissed by tapping anywhere on it', async () => {
    const onDone = vi.fn();
    render(<Celebration dog="Rex" odour="MDMA" onDone={onDone} />);
    await userEvent.click(screen.getByText('Rex: MDMA imprinted'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed from the keyboard', async () => {
    const onDone = vi.fn();
    render(<Celebration dog="Rex" odour="MDMA" onDone={onDone} />);
    await userEvent.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('vibrates [80, 40, 120] where the phone can', () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);
    render(<Celebration dog="Rex" odour="MDMA" onDone={() => {}} />);
    expect(vibrate).toHaveBeenCalledWith([80, 40, 120]);
  });

  it('does not throw when navigator.vibrate does not exist (iPhone)', () => {
    expect('vibrate' in navigator).toBe(false);
    expect(() => render(<Celebration dog="Rex" odour="MDMA" onDone={() => {}} />)).not.toThrow();
  });

  it('draws six paw prints that are hidden from screen readers', () => {
    const { container } = render(<Celebration dog="Rex" odour="MDMA" onDone={() => {}} />);
    const paws = container.querySelectorAll('[data-paw]');
    expect(paws).toHaveLength(6);
    paws.forEach((p) => expect(p.closest('[aria-hidden="true"]')).not.toBeNull());
  });
});
