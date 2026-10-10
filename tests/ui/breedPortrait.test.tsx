import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BREEDS, BREED_NOSES } from '../../src/domain/breeds';
import { BreedPortrait } from '../../src/ui/components/BreedPortrait';

describe('BreedPortrait', () => {
  it('draws the breed from public/breeds, with the breed label as its alt text', () => {
    render(<BreedPortrait breed="german-shepherd" size="md" play={false} />);
    const img = screen.getByRole('img', { name: 'German Shepherd' });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', `${import.meta.env.BASE_URL}breeds/german-shepherd.webp`);
  });

  it('multiplies the drawing into the ruled paper', () => {
    render(<BreedPortrait breed="malinois" size="sm" play={false} />);
    expect(screen.getByRole('img', { name: 'Malinois' })).toHaveStyle({ mixBlendMode: 'multiply' });
  });

  it('has three sizes, small to large', () => {
    const widths = (['sm', 'md', 'lg'] as const).map((size) => {
      const { unmount } = render(<BreedPortrait breed="hound" size={size} play={false} />);
      const w = parseFloat(screen.getByRole('img', { name: 'Hound' }).style.width);
      unmount();
      return w;
    });
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths[2]).toBeGreaterThan(widths[1]);
  });

  it('falls back to an inline ink drawing, still named for the breed, when the file will not load', () => {
    const { container } = render(<BreedPortrait breed="labrador" size="md" play />);
    fireEvent.error(screen.getByRole('img', { name: 'Labrador' }));
    expect(container.querySelector('img')).toBeNull();
    const fallback = screen.getByRole('img', { name: 'Labrador' });
    expect(fallback.tagName.toLowerCase()).toBe('svg');
  });

  it('tries the file again when the breed changes after a failure', () => {
    const { container, rerender } = render(<BreedPortrait breed="labrador" size="md" play={false} />);
    fireEvent.error(screen.getByRole('img', { name: 'Labrador' }));
    expect(container.querySelector('img')).toBeNull();
    rerender(<BreedPortrait breed="hound" size="md" play={false} />);
    expect(screen.getByRole('img', { name: 'Hound' }).tagName).toBe('IMG');
  });

  it('reports whether it should play, for the animation that comes with the art', () => {
    const { container, rerender } = render(<BreedPortrait breed="other" size="lg" play />);
    expect(container.firstElementChild).toHaveAttribute('data-play', 'true');
    rerender(<BreedPortrait breed="other" size="lg" play={false} />);
    expect(container.firstElementChild).toHaveAttribute('data-play', 'false');
  });

  it('knows every breed by its label', () => {
    for (const b of BREEDS) {
      const { unmount } = render(<BreedPortrait breed={b.id} size="sm" play={false} />);
      expect(screen.getByRole('img', { name: b.label })).toBeInTheDocument();
      unmount();
    }
  });
});

/** jsdom has no matchMedia; this stands in for it with a fixed answer to "prefers reduced motion?". */
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

const root = (container: HTMLElement) => container.querySelector('[data-breed-portrait]') as HTMLElement;
const stage = (container: HTMLElement) => container.querySelector('[data-stage]') as HTMLElement;
const wisps = (container: HTMLElement) => container.querySelectorAll('[data-wisp]');

describe('BreedPortrait animation (spec §13.3)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('plays when asked: the ink reveal and stamp settle, then the sniff loop with three scent wisps', () => {
    setReducedMotion(false);
    const { container } = render(<BreedPortrait breed="malinois" size="lg" play />);
    expect(root(container)).toHaveAttribute('data-motion', 'animated');
    expect(root(container)).toHaveClass('is-animated');
    expect(root(container)).toHaveClass('is-sniffing');
    expect(wisps(container)).toHaveLength(3);
  });

  it('rests as a still drawing, without wisps, while it is not asked to play', () => {
    setReducedMotion(false);
    const { container } = render(<BreedPortrait breed="malinois" size="lg" play={false} />);
    expect(root(container)).toHaveAttribute('data-motion', 'static');
    expect(root(container)).not.toHaveClass('is-animated');
    expect(root(container)).not.toHaveClass('is-sniffing');
    expect(wisps(container)).toHaveLength(0);
  });

  it('plays again each time the breed changes while it is playing', () => {
    setReducedMotion(false);
    const { container, rerender } = render(<BreedPortrait breed="malinois" size="lg" play />);
    const first = stage(container);
    expect(root(container)).toHaveAttribute('data-run', '1');
    rerender(<BreedPortrait breed="hound" size="lg" play />);
    expect(root(container)).toHaveAttribute('data-run', '2');
    expect(stage(container)).not.toBe(first); // a fresh element restarts the CSS animation
    rerender(<BreedPortrait breed="labrador" size="lg" play />);
    expect(root(container)).toHaveAttribute('data-run', '3');
    expect(screen.getByRole('img', { name: 'Labrador' })).toBeInTheDocument();
  });

  it('does not restart for a re-render with the same breed', () => {
    setReducedMotion(false);
    const { container, rerender } = render(<BreedPortrait breed="hound" size="lg" play />);
    const first = stage(container);
    rerender(<BreedPortrait breed="hound" size="lg" play />);
    expect(root(container)).toHaveAttribute('data-run', '1');
    expect(stage(container)).toBe(first);
  });

  it('plays when play turns on, and again when the breed changes at the same moment', () => {
    setReducedMotion(false);
    const { container, rerender } = render(<BreedPortrait breed="hound" size="lg" play={false} />);
    expect(root(container)).toHaveAttribute('data-motion', 'static');
    rerender(<BreedPortrait breed="hound" size="lg" play />);
    expect(root(container)).toHaveAttribute('data-motion', 'animated');
    expect(root(container)).toHaveAttribute('data-run', '1');
    rerender(<BreedPortrait breed="hound" size="lg" play={false} />);
    expect(root(container)).toHaveAttribute('data-motion', 'static');
    rerender(<BreedPortrait breed="bloodhound" size="lg" play />);
    expect(root(container)).toHaveAttribute('data-run', '2');
  });

  it('stays a static drawing, with no wisps, under prefers-reduced-motion', () => {
    setReducedMotion(true);
    const { container } = render(<BreedPortrait breed="malinois" size="lg" play />);
    expect(root(container)).toHaveAttribute('data-play', 'true');
    expect(root(container)).toHaveAttribute('data-motion', 'static');
    expect(root(container)).not.toHaveClass('is-animated');
    expect(wisps(container)).toHaveLength(0);
    expect(screen.getByRole('img', { name: 'Malinois' })).toBeInTheDocument();
  });

  it('is always static at the small size, even when asked to play', () => {
    setReducedMotion(false);
    const { container } = render(<BreedPortrait breed="malinois" size="sm" play />);
    expect(root(container)).toHaveAttribute('data-motion', 'static');
    expect(wisps(container)).toHaveLength(0);
  });

  it('plays the reveal but not the sniff loop when it is told to stay idle (no timer running)', () => {
    setReducedMotion(false);
    const { container, rerender } = render(<BreedPortrait breed="malinois" size="md" play idle={false} />);
    expect(root(container)).toHaveClass('is-animated');
    expect(root(container)).not.toHaveClass('is-sniffing');
    expect(wisps(container)).toHaveLength(0);
    const first = stage(container);
    rerender(<BreedPortrait breed="malinois" size="md" play idle />);
    expect(root(container)).toHaveClass('is-sniffing');
    expect(wisps(container)).toHaveLength(3);
    expect(stage(container)).toBe(first); // starting to sniff does not replay the reveal
  });

  it('gives the fallback paw the same reveal and settle, but no wisps and no sniff', () => {
    setReducedMotion(false);
    const { container } = render(<BreedPortrait breed="labrador" size="lg" play />);
    fireEvent.error(screen.getByRole('img', { name: 'Labrador' }));
    expect(screen.getByRole('img', { name: 'Labrador' }).tagName.toLowerCase()).toBe('svg');
    expect(root(container)).toHaveAttribute('data-motion', 'animated');
    expect(root(container)).toHaveClass('is-animated');
    expect(root(container)).not.toHaveClass('is-sniffing');
    expect(stage(container)).toContainElement(screen.getByRole('img', { name: 'Labrador' }));
    expect(wisps(container)).toHaveLength(0);
  });

  it('positions the wisps at the breed nose point, as percentages of the drawing', () => {
    setReducedMotion(false);
    for (const b of BREEDS) {
      const { container, unmount } = render(<BreedPortrait breed={b.id} size="lg" play />);
      const layer = container.querySelector('[data-wisps]') as HTMLElement;
      expect(layer.style.left).toBe(`${BREED_NOSES[b.id].x}%`);
      expect(layer.style.top).toBe(`${BREED_NOSES[b.id].y}%`);
      unmount();
    }
  });

  it('keeps the wisps out of the accessibility tree', () => {
    setReducedMotion(false);
    const { container } = render(<BreedPortrait breed="malinois" size="lg" play />);
    expect(container.querySelector('[data-wisps]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('keeps the alt text as the breed label while playing', () => {
    setReducedMotion(false);
    for (const b of BREEDS) {
      const { unmount } = render(<BreedPortrait breed={b.id} size="lg" play />);
      expect(screen.getByRole('img', { name: b.label })).toBeInTheDocument();
      unmount();
    }
  });
});
