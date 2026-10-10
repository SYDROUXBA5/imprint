import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../../src/domain/types';

vi.mock('../../src/data/account');
const account = await import('../../src/data/account');
const { db, ME_KEY } = await import('../../src/data/db');
const { AppRoutes } = await import('../../src/App');

const member = (id: string, name: string, role: Member['role'], removedAt: string | null = null): Member => ({
  id, unit_id: 'u1', user_id: `u-${id}`, name, role, joined_at: '2026-10-01T00:00:00Z', removed_at: removedAt,
});
const tess = member('mT', 'Tess', 'trainer');
const ana = member('mN', 'Ana', 'trainer');
const hana = member('mA', 'Hana', 'handler');
const paul = member('mP', 'Paul', 'handler');
const old = member('mO', 'Olga', 'handler', '2026-10-04T00:00:00Z');

let online = true;
async function seed(me: Member = tess, others: Member[] = [ana, hana, paul, old]) {
  await db.meta.put({ key: ME_KEY, value: me });
  await db.units.put({ id: 'u1', name: 'Border K9', invite_code: 'K7M2QX', created_at: '2026-10-01T00:00:00Z' });
  await db.members.bulkPut([me, ...others.filter((m) => m.id !== me.id)]);
}
const renderMembers = (me: Member = tess) =>
  render(<MemoryRouter initialEntries={['/members']}><AppRoutes me={me} /></MemoryRouter>);
const rowOf = async (name: string) => within((await screen.findByText(name)).closest('li')!);

beforeEach(async () => {
  vi.clearAllMocks();
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.mocked(account.regenerateInviteCode).mockResolvedValue('NEW4CD');
  vi.mocked(account.removeMember).mockResolvedValue(undefined);
  vi.mocked(account.setRole).mockResolvedValue(undefined);
  vi.mocked(account.loadMe).mockResolvedValue(null);
  await db.delete();
  await db.open();
});

describe('MembersScreen', () => {
  it('is called Members, and nothing on it calls the people "Team"', async () => {
    await seed();
    renderMembers();
    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    for (const heading of screen.getAllByRole('heading')) expect(heading).not.toHaveTextContent(/^Team$/);
    expect(screen.queryByText(/\bTeam\b/)).toBeNull();
  });

  it('shows the invite code large, with letter spacing', async () => {
    await seed();
    renderMembers();
    const code = await screen.findByTestId('invite-code');
    expect(code).toHaveTextContent('K7M2QX');
    const style = getComputedStyle(code);
    expect(parseFloat(style.fontSize)).toBeGreaterThanOrEqual(36);
    expect(style.letterSpacing).not.toBe('normal');
    expect(parseFloat(style.letterSpacing)).toBeGreaterThan(0);
  });

  it('lists active members with their role and the matching buttons', async () => {
    await seed();
    renderMembers();
    const hanaRow = await rowOf('Hana');
    expect(hanaRow.getByText('Handler')).toBeInTheDocument();
    expect(hanaRow.getByRole('button', { name: 'Make Hana a trainer' })).toHaveTextContent('Make trainer');
    expect(hanaRow.getByRole('button', { name: 'Remove Hana' })).toHaveTextContent('Remove');
    const anaRow = await rowOf('Ana');
    expect(anaRow.getByText('Trainer')).toBeInTheDocument();
    expect(anaRow.getByRole('button', { name: 'Make Ana a handler' })).toHaveTextContent('Make handler');
    const me = await rowOf('Tess');
    expect(me.getByText('you')).toBeInTheDocument();
  });

  it('lists removed members greyed under "Removed", with no buttons', async () => {
    await seed();
    renderMembers();
    const removed = within(await screen.findByRole('region', { name: 'Removed' }));
    const olga = within(removed.getByText('Olga').closest('li')!);
    expect(olga.queryByRole('button')).toBeNull();
    expect(removed.getByText('Olga').closest('li')).toHaveStyle({ opacity: '0.55' });
    // and not among the active members
    const active = within(screen.getByRole('region', { name: 'Members' }));
    expect(active.queryByText('Olga')).toBeNull();
  });

  it('has no "Removed" section when nobody was removed', async () => {
    await seed(tess, [hana]);
    renderMembers();
    await screen.findByText('Hana');
    expect(screen.queryByRole('region', { name: 'Removed' })).toBeNull();
  });

  describe('New code', () => {
    it('asks first: "The old code will stop working."', async () => {
      await seed();
      renderMembers();
      await userEvent.click(await screen.findByRole('button', { name: 'New code' }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(dialog.getByText('The old code will stop working.')).toBeInTheDocument();
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(account.regenerateInviteCode).not.toHaveBeenCalled();
      expect(screen.getByTestId('invite-code')).toHaveTextContent('K7M2QX');
    });

    it('regenerates after confirmation, shows the new code and refreshes the member', async () => {
      await seed();
      renderMembers();
      await userEvent.click(await screen.findByRole('button', { name: 'New code' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Make new code' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(account.regenerateInviteCode).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(account.loadMe).toHaveBeenCalled());
      expect(await screen.findByText('NEW4CD')).toBeInTheDocument();
    });
  });

  describe('changing roles', () => {
    it('Make trainer calls setRole and refreshes', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await rowOf('Hana')).getByRole('button', { name: 'Make Hana a trainer' }));
      await waitFor(() => expect(account.setRole).toHaveBeenCalledWith('mA', 'trainer'));
      await waitFor(() => expect(account.loadMe).toHaveBeenCalled());
      const row = await rowOf('Hana');
      await waitFor(() => expect(row.getByText('Trainer')).toBeInTheDocument());
      expect(row.getByRole('button', { name: 'Make Hana a handler' })).toBeInTheDocument();
    });

    it('Make handler calls setRole', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await rowOf('Ana')).getByRole('button', { name: 'Make Ana a handler' }));
      await waitFor(() => expect(account.setRole).toHaveBeenCalledWith('mN', 'handler'));
      await waitFor(() => expect(account.loadMe).toHaveBeenCalled()); // let the action finish before the test ends
    });

    it('shows "A unit needs at least one trainer." when the server blocks it', async () => {
      await seed(tess, [hana]);
      vi.mocked(account.setRole).mockRejectedValue(new Error('a unit needs at least one trainer'));
      renderMembers();
      await userEvent.click((await rowOf('Tess')).getByRole('button', { name: 'Make Tess a handler' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('A unit needs at least one trainer.');
      expect(account.loadMe).not.toHaveBeenCalled();
    });
  });

  describe('removing', () => {
    it('asks "Remove Paul? Their past sessions stay in the log." and does nothing on Cancel', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await rowOf('Paul')).getByRole('button', { name: 'Remove Paul' }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(dialog.getByText('Remove Paul? Their past sessions stay in the log.')).toBeInTheDocument();
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(account.removeMember).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('removes after confirmation and moves the member under "Removed"', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await rowOf('Paul')).getByRole('button', { name: 'Remove Paul' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove Paul' }));
      await waitFor(() => expect(account.removeMember).toHaveBeenCalledWith('mP'));
      await waitFor(() => expect(account.loadMe).toHaveBeenCalled());
      const removed = within(await screen.findByRole('region', { name: 'Removed' }));
      expect(await removed.findByText('Paul')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Members' })).queryByText('Paul')).toBeNull();
    });

    it('shows "A unit needs at least one trainer." when the last trainer removes themself', async () => {
      await seed(tess, [hana]);
      vi.mocked(account.removeMember).mockRejectedValue(new Error('a unit needs at least one trainer'));
      renderMembers();
      await userEvent.click((await rowOf('Tess')).getByRole('button', { name: 'Remove Tess' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove Tess' }));
      expect(await within(await screen.findByRole('dialog')).findByRole('alert'))
        .toHaveTextContent('A unit needs at least one trainer.');
      expect((await db.members.get('mT'))!.removed_at).toBeNull();
    });
  });

  describe('with no signal', () => {
    it('disables every member button and says "Member changes need signal."', async () => {
      await seed();
      online = false;
      renderMembers();
      await screen.findByText('Hana');
      expect(screen.getByText('Member changes need signal.')).toBeInTheDocument();
      for (const b of [
        screen.getByRole('button', { name: 'New code' }),
        screen.getByRole('button', { name: 'Make Hana a trainer' }),
        screen.getByRole('button', { name: 'Remove Hana' }),
        screen.getByRole('button', { name: 'Make Ana a handler' }),
      ]) expect(b).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Remove Hana' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('enables them again when the signal returns', async () => {
      await seed();
      online = false;
      renderMembers();
      await screen.findByText('Member changes need signal.');
      online = true;
      act(() => { window.dispatchEvent(new Event('online')); });
      await waitFor(() => expect(screen.getByRole('button', { name: 'New code' })).toBeEnabled());
      expect(screen.queryByText('Member changes need signal.')).toBeNull();
    });
  });

  describe('roles', () => {
    it('sends a handler who opens /members back to the home screen', async () => {
      await seed(hana, [tess, paul]);
      renderMembers(hana);
      expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New code' })).toBeNull();
      expect(screen.queryByTestId('invite-code')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
    });

    it('back goes to the home screen', async () => {
      await seed();
      renderMembers();
      await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
      expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument();
    });
  });
});
