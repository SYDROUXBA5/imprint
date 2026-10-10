import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BREEDS } from '../../src/domain/breeds';
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
