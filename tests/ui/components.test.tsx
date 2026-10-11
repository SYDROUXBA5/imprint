import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacity } from '../../src/ui/components/Capacity';
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

  it('ProgressBar draws the logged time in moss and a running session\'s time after it in brass', () => {
    // 45 minutes in all, 15 of them live: 30 logged (40%) then 15 live (20%).
    render(<ProgressBar valueS={2700} liveS={900} label="MDMA" size="large" />);
    const bar = screen.getByRole('progressbar', { name: 'MDMA' });
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar).toHaveClass('bar-large');
    expect(bar.querySelector('[data-bar-logged]')).toHaveStyle({ width: '40%' });
    expect(bar.querySelector('[data-bar-live]')).toHaveStyle({ left: '40%', width: '20%' });
  });

  it('ProgressBar has no brass segment when nothing is running, and none past the end of the bar', () => {
    const { rerender } = render(<ProgressBar valueS={1800} label="MDMA" />);
    expect(screen.getByRole('progressbar').querySelector('[data-bar-live]')).toBeNull();
    expect(screen.getByRole('progressbar').querySelector('[data-bar-logged]')).toHaveStyle({ width: '40%' });
    rerender(<ProgressBar valueS={9000} liveS={1200} label="MDMA" />); // 150 min, capped at the full bar
    const bar = screen.getByRole('progressbar');
    const logged = parseFloat((bar.querySelector('[data-bar-logged]') as HTMLElement).style.width);
    const live = parseFloat((bar.querySelector('[data-bar-live]') as HTMLElement).style.width);
    expect(logged + live).toBeCloseTo(100);
  });

  describe('Capacity', () => {
    const dots = () => screen.queryByTestId('capacity-dots');
    it('draws a filled dot per dog and an outlined one per place still free, then says "3 of 6 dogs"', () => {
      render(<Capacity count={3} planned={6} />);
      expect(dots()!.querySelectorAll('.dot-filled')).toHaveLength(3);
      expect(dots()!.querySelectorAll('.dot:not(.dot-filled)')).toHaveLength(3);
      expect(dots()).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('3 of 6 dogs')).toBeInTheDocument();
    });
    it('keeps the dots up to a plan of 12 dogs, and shows text alone above that', () => {
      const { rerender } = render(<Capacity count={2} planned={12} />);
      expect(dots()!.children).toHaveLength(12);
      rerender(<Capacity count={2} planned={13} />);
      expect(dots()).toBeNull();
      expect(screen.getByText('2 of 13 dogs')).toBeInTheDocument();
    });
    it('shows "2 dogs" with no dots for a team with no planned size', () => {
      render(<Capacity count={2} planned={null} />);
      expect(dots()).toBeNull();
      expect(screen.getByText('2 dogs')).toBeInTheDocument();
    });
    it('fills a dot for every dog even when there are more dogs than planned places', () => {
      render(<Capacity count={5} planned={4} />);
      expect(dots()!.querySelectorAll('.dot-filled')).toHaveLength(5);
      expect(dots()!.querySelectorAll('.dot:not(.dot-filled)')).toHaveLength(0);
    });
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
    render(<HeaderBar title="Rex" onBack={onBack} right={<a href="#x">Members</a>} />);
    expect(screen.getByRole('heading', { name: 'Rex' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument();
  });

  it('HeaderBar has no back button without onBack', () => {
    render(<HeaderBar title="Dogs" />);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  describe('SyncBadge', () => {
    it('says everything is saved and synced at 0 pending and 0 rejected', () => {
      render(<SyncBadge pending={0} rejected={0} stale={false} />);
      expect(screen.getByRole('status')).toHaveTextContent('Everything saved and synced.');
    });
    it('counts the changes waiting, singular and plural', () => {
      const { rerender } = render(<SyncBadge pending={1} rejected={0} stale={false} />);
      expect(screen.getByText('1 change waiting to sync.')).toBeInTheDocument();
      expect(screen.queryByText('Everything saved and synced.')).toBeNull();
      rerender(<SyncBadge pending={3} rejected={0} stale={false} />);
      expect(screen.getByText('3 changes waiting to sync.')).toBeInTheDocument();
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
    it('shows dog, odour, handler and the live clock in a RUNNING NOW box, and ticks', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-03T10:07:04Z'));
      render(<RunningBanner items={[{ dog: 'Rex', odour: 'MDMA', handler: 'Paul', startedAt: '2026-10-03T10:00:00Z' }]} />);
      expect(screen.getByText('Running now')).toBeInTheDocument();
      expect(screen.getByText('Rex on MDMA, with Paul')).toBeInTheDocument();
      expect(screen.getByText('07:04')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByText('07:05')).toBeInTheDocument();
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
