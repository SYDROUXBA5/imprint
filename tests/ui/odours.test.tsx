import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ME_KEY } from '../../src/data/db';
import type { Member } from '../../src/domain/types';
import { seedCatalogue } from '../fixtures';
import { OdoursScreen } from '../../src/ui/screens/OdoursScreen';

const trainer: Member = { id: 'mT', unit_id: 'u1', user_id: 'uT', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };
const GONE = '2026-10-02T00:00:00Z';

async function seed() {
  await db.meta.put({ key: ME_KEY, value: trainer });
  await seedCatalogue(db);
}
function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}
const renderOdours = () => render(
  <MemoryRouter initialEntries={['/odours']}>
    <Routes>
      <Route path="/odours" element={<OdoursScreen />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const category = async (name: string) => within(await screen.findByRole('region', { name }));
const sheet = async () => within(await screen.findByRole('dialog'));
const outbox = async () => (await db.outbox.toArray()).map((i) => `${i.table}:${i.op}`);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('OdoursScreen', () => {
  it('is called Odours and goes back to the teams', async () => {
    await seed();
    renderOdours();
    expect(await screen.findByRole('heading', { level: 1, name: 'Odours' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('lists the categories in order, each with its odours by name', async () => {
    await seed();
    renderOdours();
    await screen.findByRole('region', { name: 'Narcotics' });
    const order = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(order).toEqual(['Narcotics', 'Explosives', 'Cadaver', 'Bed bugs']);
    const narcotics = await category('Narcotics');
    expect(narcotics.getAllByRole('listitem').map((li) => li.querySelector('[data-odour-name]')?.textContent))
      .toEqual(['Cannabis', 'Cocaine', 'Fentanyl', 'Heroin', 'MDMA', 'Methamphetamine']);
    expect((await category('Explosives')).getAllByRole('listitem')).toHaveLength(11);
  });

  it('says so when a category has no odours', async () => {
    await seed();
    await db.odour_categories.put({ id: 'currency', unit_id: 'u1', name: 'Currency', sort: 9, created_at: '', archived_at: null });
    renderOdours();
    expect((await category('Currency')).getByText('No odours yet')).toBeInTheDocument();
  });

  describe('add category', () => {
    it('adds a category at the end', async () => {
      await seed();
      renderOdours();
      await userEvent.click(await screen.findByRole('button', { name: '+ Add category' }));
      const dialog = await sheet();
      const add = dialog.getByRole('button', { name: 'Add category' });
      expect(add).toBeDisabled();
      await userEvent.type(dialog.getByLabelText('Category name'), '  Currency ');
      await userEvent.click(add);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const order = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
      expect(order).toEqual(['Narcotics', 'Explosives', 'Cadaver', 'Bed bugs', 'Currency']);
      expect(await outbox()).toEqual(['odour_categories:insert']);
    });

    it('says clearly when the name is taken, ignoring case, and writes nothing', async () => {
      await seed();
      renderOdours();
      await userEvent.click(await screen.findByRole('button', { name: '+ Add category' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Category name'), 'narcotics');
      await userEvent.click(dialog.getByRole('button', { name: 'Add category' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('There is already a category called "Narcotics".');
      expect(dialog.getByLabelText('Category name')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('dialog')).toBeInTheDocument(); // still open, so the name can be changed
      expect(await db.outbox.count()).toBe(0);
    });

    it('points to Restore when an archived category has the name', async () => {
      await seed();
      await db.odour_categories.update('cadaver', { archived_at: GONE });
      renderOdours();
      await userEvent.click(await screen.findByRole('button', { name: '+ Add category' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Category name'), 'Cadaver');
      await userEvent.click(dialog.getByRole('button', { name: 'Add category' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('There is already an archived category called "Cadaver". Restore it instead.');
    });

    it('clears the message as soon as the name is edited', async () => {
      await seed();
      renderOdours();
      await userEvent.click(await screen.findByRole('button', { name: '+ Add category' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Category name'), 'Cadaver');
      await userEvent.click(dialog.getByRole('button', { name: 'Add category' }));
      await dialog.findByRole('alert');
      await userEvent.type(dialog.getByLabelText('Category name'), 's');
      expect(dialog.queryByRole('alert')).toBeNull();
      expect(dialog.getByLabelText('Category name')).not.toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('add odour', () => {
    it('adds an odour to that category', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Narcotics')).getByRole('button', { name: 'Add odour to Narcotics' }));
      const dialog = await sheet();
      expect(dialog.getByRole('heading', { name: 'New odour in Narcotics' })).toBeInTheDocument();
      await userEvent.type(dialog.getByLabelText('Odour name'), 'Carfentanil');
      await userEvent.click(dialog.getByRole('button', { name: 'Add odour' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(within(await screen.findByRole('region', { name: 'Narcotics' })).getByText('Carfentanil')).toBeInTheDocument();
      expect(await outbox()).toEqual(['odours:insert']);
    });

    it('says clearly when the category already has that odour, ignoring case, and writes nothing', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Narcotics')).getByRole('button', { name: 'Add odour to Narcotics' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Odour name'), 'COCAINE');
      await userEvent.click(dialog.getByRole('button', { name: 'Add odour' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('There is already an odour called "Cocaine" in Narcotics.');
      expect(await db.outbox.count()).toBe(0);
    });

    it('allows the same name in another category', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Explosives')).getByRole('button', { name: 'Add odour to Explosives' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Odour name'), 'Cocaine');
      await userEvent.click(dialog.getByRole('button', { name: 'Add odour' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await outbox()).toEqual(['odours:insert']);
    });

    it('points to Restore when an archived odour has the name', async () => {
      await seed();
      await db.odours.update('cocaine', { archived_at: GONE });
      renderOdours();
      await userEvent.click((await category('Narcotics')).getByRole('button', { name: 'Add odour to Narcotics' }));
      const dialog = await sheet();
      await userEvent.type(dialog.getByLabelText('Odour name'), 'Cocaine');
      await userEvent.click(dialog.getByRole('button', { name: 'Add odour' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('There is already an archived odour called "Cocaine" in Narcotics. Restore it instead.');
    });
  });

  describe('rename', () => {
    it('renames a category', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Cadaver')).getByRole('button', { name: 'Rename Cadaver' }));
      const dialog = await sheet();
      const field = dialog.getByLabelText('Category name');
      expect(field).toHaveValue('Cadaver');
      await userEvent.clear(field);
      expect(dialog.getByRole('button', { name: 'Save name' })).toBeDisabled();
      await userEvent.type(field, 'Human remains');
      await userEvent.click(dialog.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByRole('region', { name: 'Human remains' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Cadaver' })).toBeNull();
      expect((await db.outbox.toArray()).map((i) => i.row)).toEqual([{ id: 'cadaver', name: 'Human remains' }]);
    });

    it('renames an odour', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Narcotics')).getByRole('button', { name: 'Rename MDMA' }));
      const dialog = await sheet();
      expect(dialog.getByLabelText('Odour name')).toHaveValue('MDMA');
      await userEvent.clear(dialog.getByLabelText('Odour name'));
      await userEvent.type(dialog.getByLabelText('Odour name'), 'Ecstasy');
      await userEvent.click(dialog.getByRole('button', { name: 'Save name' }));
      expect(await screen.findByText('Ecstasy')).toBeInTheDocument();
      expect((await db.odours.get('mdma'))!.name).toBe('Ecstasy');
    });

    it('refuses a name that is taken, with the message, and keeps the old name', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Narcotics')).getByRole('button', { name: 'Rename MDMA' }));
      const dialog = await sheet();
      await userEvent.clear(dialog.getByLabelText('Odour name'));
      await userEvent.type(dialog.getByLabelText('Odour name'), 'heroin');
      await userEvent.click(dialog.getByRole('button', { name: 'Save name' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('There is already an odour called "Heroin" in Narcotics.');
      expect((await db.odours.get('mdma'))!.name).toBe('MDMA');
    });

    it('refuses a category name that is taken', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Cadaver')).getByRole('button', { name: 'Rename Cadaver' }));
      const dialog = await sheet();
      await userEvent.clear(dialog.getByLabelText('Category name'));
      await userEvent.type(dialog.getByLabelText('Category name'), 'explosives');
      await userEvent.click(dialog.getByRole('button', { name: 'Save name' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('There is already a category called "Explosives".');
    });
  });

  describe('archive and restore', () => {
    it('asks before archiving an odour, and Cancel keeps it', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Narcotics')).getByRole('button', { name: 'Archive Cocaine' }));
      const dialog = await sheet();
      expect(dialog.getByText(/^Archive Cocaine\?/)).toHaveTextContent('Time already logged stays in the log');
      expect((await db.odours.get('cocaine'))!.archived_at).toBeNull(); // one tap did not archive
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect((await db.odours.get('cocaine'))!.archived_at).toBeNull();
    });

    it('archives an odour on confirm, and it moves to Archived', async () => {
      await seed();
      renderOdours();
      expect(screen.queryByRole('region', { name: 'Archived' })).toBeNull(); // nothing archived yet
      await userEvent.click((await category('Narcotics')).getByRole('button', { name: 'Archive Cocaine' }));
      await userEvent.click((await sheet()).getByRole('button', { name: 'Archive Cocaine' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect((await db.odours.get('cocaine'))!.archived_at).not.toBeNull();
      expect((await category('Narcotics')).queryByText('Cocaine')).toBeNull();
      const archived = await category('Archived');
      expect(archived.getByText('Cocaine')).toBeInTheDocument();
      expect(archived.getByText('Narcotics')).toBeInTheDocument(); // which category it was in
      expect(await outbox()).toEqual(['odours:update']);
    });

    it('restores an archived odour', async () => {
      await seed();
      await db.odours.update('cocaine', { archived_at: GONE });
      renderOdours();
      await userEvent.click((await category('Archived')).getByRole('button', { name: 'Restore Cocaine' }));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Archived' })).toBeNull());
      expect((await category('Narcotics')).getByText('Cocaine')).toBeInTheDocument();
      expect((await db.odours.get('cocaine'))!.archived_at).toBeNull();
    });

    it('asks before archiving a category, and archiving hides it with its odours', async () => {
      await seed();
      renderOdours();
      await userEvent.click((await category('Cadaver')).getByRole('button', { name: 'Archive Cadaver' }));
      const dialog = await sheet();
      expect(dialog.getByText(/^Archive Cadaver\?/)).toBeInTheDocument();
      expect((await db.odour_categories.get('cadaver'))!.archived_at).toBeNull();
      await userEvent.click(dialog.getByRole('button', { name: 'Archive Cadaver' }));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Cadaver' })).toBeNull());
      const archived = await category('Archived');
      expect(archived.getByText('Cadaver')).toBeInTheDocument();
      expect(archived.queryByText('Human remains')).toBeNull(); // its odours are not archived on their own
      expect(await outbox()).toEqual(['odour_categories:update']);
    });

    it('restores an archived category', async () => {
      await seed();
      await db.odour_categories.update('cadaver', { archived_at: GONE });
      renderOdours();
      await userEvent.click((await category('Archived')).getByRole('button', { name: 'Restore Cadaver' }));
      expect(await screen.findByRole('region', { name: 'Cadaver' })).toBeInTheDocument();
      expect((await category('Cadaver')).getByText('Human remains')).toBeInTheDocument();
    });

    it('cannot restore an archived odour while its category is archived', async () => {
      await seed();
      await db.odour_categories.update('narcotics', { archived_at: GONE });
      await db.odours.update('cocaine', { archived_at: GONE });
      renderOdours();
      const archived = await category('Archived');
      expect(archived.getByRole('button', { name: 'Restore Narcotics' })).toBeInTheDocument();
      expect(archived.queryByRole('button', { name: 'Restore Cocaine' })).toBeNull();
      expect(archived.getByText('Restore the category first')).toBeInTheDocument();
    });
  });
});
