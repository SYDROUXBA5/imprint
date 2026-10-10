import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Odour, OdourCategory } from '../../src/domain/types';
import { CATEGORIES, ODOURS } from '../fixtures';
import { OdourPicker } from '../../src/ui/components/OdourPicker';

const catalogue = { categories: CATEGORIES, odours: ODOURS };

/** The picker with its own state, reporting every change. */
function Harness({ start = [], onChange = () => {}, ...rest }: {
  start?: string[]; onChange?: (s: Set<string>) => void; categories?: OdourCategory[]; odours?: Odour[];
}) {
  const [selected, setSelected] = useState(new Set(start));
  return (
    <OdourPicker categories={rest.categories ?? catalogue.categories} odours={rest.odours ?? catalogue.odours}
      selected={selected} onChange={(s) => { setSelected(s); onChange(s); }} />
  );
}
const group = (name: string) => within(screen.getByRole('group', { name }));

describe('OdourPicker', () => {
  it('lists the categories in the catalogue\'s order, each with its odours as check boxes', () => {
    render(<Harness />);
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Narcotics', 'Explosives', 'Cadaver', 'Bed bugs']);
    expect(group('Narcotics').getAllByRole('checkbox')).toHaveLength(6);
    expect(group('Explosives').getAllByRole('checkbox')).toHaveLength(11);
    expect(group('Cadaver').getByRole('checkbox', { name: 'Human remains' })).not.toBeChecked();
  });

  it('shows the ticked odours as checked and says how many are chosen', () => {
    render(<Harness start={['cocaine', 'tnt', 'viable-eggs']} />);
    expect(group('Narcotics').getByRole('checkbox', { name: 'Cocaine' })).toBeChecked();
    expect(group('Narcotics').getByRole('checkbox', { name: 'Heroin' })).not.toBeChecked();
    expect(screen.getByText('3 odours selected')).toBeInTheDocument();
  });

  it('says "1 odour selected" and "No odours selected"', async () => {
    render(<Harness />);
    expect(screen.getByText('No odours selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cocaine' }));
    expect(screen.getByText('1 odour selected')).toBeInTheDocument();
  });

  it('reports the new selection when an odour is ticked and unticked', async () => {
    const onChange = vi.fn();
    render(<Harness start={['cocaine']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'TNT' }));
    expect([...onChange.mock.lastCall![0]].sort()).toEqual(['cocaine', 'tnt']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cocaine' }));
    expect([...onChange.mock.lastCall![0]]).toEqual(['tnt']);
  });

  it('"Select all" ticks a whole category, leaves the others alone, and a second tap clears just that category', async () => {
    render(<Harness start={['tnt']} />);
    const all = screen.getByRole('button', { name: 'Select all Narcotics' });
    expect(all).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(all);
    for (const box of group('Narcotics').getAllByRole('checkbox')) expect(box).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'TNT' })).toBeChecked(); // another category: untouched
    expect(screen.getByRole('checkbox', { name: 'PETN' })).not.toBeChecked();
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('7 odours selected')).toBeInTheDocument();
    await userEvent.click(all);
    for (const box of group('Narcotics').getAllByRole('checkbox')) expect(box).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'TNT' })).toBeChecked();
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  it('is pressed only when every odour of that category is ticked', async () => {
    render(<Harness start={['cocaine', 'heroin', 'methamphetamine', 'mdma', 'cannabis']} />);
    const all = screen.getByRole('button', { name: 'Select all Narcotics' });
    expect(all).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fentanyl' }));
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves out archived odours and archived categories', () => {
    const categories = CATEGORIES.map((c) => (c.id === 'cadaver' ? { ...c, archived_at: '2026-10-02T00:00:00Z' } : c));
    const odours = ODOURS.map((o) => (o.id === 'cocaine' ? { ...o, archived_at: '2026-10-02T00:00:00Z' } : o));
    render(<Harness categories={categories} odours={odours} />);
    expect(screen.queryByRole('group', { name: 'Cadaver' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Human remains' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Cocaine' })).toBeNull();
    expect(group('Narcotics').getAllByRole('checkbox')).toHaveLength(5);
  });

  it('does not count an archived odour that is still in the selection', () => {
    const odours = ODOURS.map((o) => (o.id === 'cocaine' ? { ...o, archived_at: '2026-10-02T00:00:00Z' } : o));
    render(<Harness start={['cocaine', 'tnt']} odours={odours} />);
    expect(screen.getByText('1 odour selected')).toBeInTheDocument();
  });

  it('says so when a category has no odours yet', () => {
    const categories = [...CATEGORIES, { ...CATEGORIES[0], id: 'currency', name: 'Currency', sort: 9 }];
    render(<Harness categories={categories} />);
    expect(group('Currency').getByText('No odours yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select all Currency' })).toBeNull();
  });
});
