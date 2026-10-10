import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompassRing } from '../../src/ui/components/CompassRing';
import { HeaderBar } from '../../src/ui/components/HeaderBar';
import { ImprintedStamp } from '../../src/ui/components/ImprintedStamp';
import { Monogram } from '../../src/ui/components/Monogram';
import { PillToggle } from '../../src/ui/components/PillToggle';
import { ProgressBar } from '../../src/ui/components/ProgressBar';
import { RunningBanner } from '../../src/ui/components/RunningBanner';
import { Sheet } from '../../src/ui/components/Sheet';
import { SyncBadge } from '../../src/ui/components/SyncBadge';

afterEach(() => vi.useRealTimers());

describe('components', () => {
  it('ProgressBar caps at 100% and exposes progress to screen readers', () => {
    render(<ProgressBar valueS={9000} label="MDMA" />);
    const bar = screen.getByRole('progressbar', { name: 'MDMA' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('ProgressBar shows 99% at 74:59, not 100%', () => {
    render(<ProgressBar valueS={4499} label="MDMA" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99');
  });

  it('CompassRing shows the fraction of 75 min', () => {
    render(<CompassRing totalS={2250}>12:04</CompassRing>);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('12:04')).toBeInTheDocument();
  });

  it('PillToggle switches category and reports the selected one with aria-pressed', async () => {
    const onChange = vi.fn();
    const options = [{ value: 'narcotics', label: 'Narcotics' }, { value: 'explosives', label: 'Explosives' }];
    render(<PillToggle value="narcotics" options={options} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Narcotics' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Explosives' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Explosives' }));
    expect(onChange).toHaveBeenCalledWith('explosives');
  });

  it('PillToggle scrolls sideways with more than three options, and does not with three or fewer', () => {
    const four = ['a', 'b', 'c', 'd'].map((v) => ({ value: v, label: v.toUpperCase() }));
    const { unmount } = render(<PillToggle value="a" options={four} onChange={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('group', { name: 'Odour category' })).toHaveStyle({ overflowX: 'auto' });
    unmount();
    render(<PillToggle value="a" options={four.slice(0, 3)} onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Odour category' })).toHaveStyle({ overflowX: 'hidden' });
  });

  it('Monogram shows the first letter, upper-cased', () => {
    render(<Monogram name="rex" />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('ImprintedStamp is announced as "Imprinted"', () => {
    render(<ImprintedStamp size="hero" />);
    expect(screen.getByRole('img', { name: 'Imprinted' })).toBeInTheDocument();
  });

  it('HeaderBar shows the title and a working back button', async () => {
    const onBack = vi.fn();
    render(<HeaderBar title="Rex" onBack={onBack} right={<a href="#x">Team</a>} />);
    expect(screen.getByRole('heading', { name: 'Rex' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
  });

  it('HeaderBar has no back button without onBack', () => {
    render(<HeaderBar title="Dogs" />);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  describe('SyncBadge', () => {
    it('is hidden at 0 pending and 0 rejected', () => {
      const { container } = render(<SyncBadge pending={0} rejected={0} stale={false} />);
      expect(container).toBeEmptyDOMElement();
    });
    it('counts records, singular and plural', () => {
      const { rerender } = render(<SyncBadge pending={1} rejected={0} stale={false} />);
      expect(screen.getByText('1 record not synced yet')).toBeInTheDocument();
      rerender(<SyncBadge pending={3} rejected={0} stale={false} />);
      expect(screen.getByText('3 records not synced yet')).toBeInTheDocument();
    });
    it('warns when stale and when the server rejected records', () => {
      render(<SyncBadge pending={2} rejected={1} stale />);
      expect(screen.getByText('Open with signal before clearing this phone.')).toBeInTheDocument();
      expect(screen.getByText('1 record rejected by the server')).toBeInTheDocument();
    });
  });

  describe('RunningBanner', () => {
    it('renders nothing when no timer runs', () => {
      const { container } = render(<RunningBanner items={[]} />);
      expect(container).toBeEmptyDOMElement();
    });
    it('shows dog, odour, live clock and handler, and ticks', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-03T10:12:04Z'));
      render(<RunningBanner items={[{ dog: 'Rex', odour: 'MDMA', handler: 'Paul', startedAt: '2026-10-03T10:00:00Z' }]} />);
      expect(screen.getByText('Running · Rex · MDMA · 12:04 · Paul')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByText('Running · Rex · MDMA · 12:05 · Paul')).toBeInTheDocument();
    });
    it('does not start a clock when nothing runs', () => {
      vi.useFakeTimers();
      render(<RunningBanner items={[]} />);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('Sheet', () => {
    it('renders nothing when closed', () => {
      render(<Sheet open={false} onClose={() => {}} title="Add dog">body</Sheet>);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    it('is a labelled dialog that closes on Escape, Close and the backdrop', async () => {
      const onClose = vi.fn();
      render(<Sheet open onClose={onClose} title="Add dog"><input aria-label="Name" /></Sheet>);
      const dialog = screen.getByRole('dialog', { name: 'Add dog' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByLabelText('Name')).toHaveFocus();
      await userEvent.keyboard('{Escape}');
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByTestId('sheet-backdrop'));
      expect(onClose).toHaveBeenCalledTimes(3);
    });
  });
});
