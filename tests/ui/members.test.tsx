import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, Member } from '../../src/domain/types';
import { meRecord } from '../fixtures';

vi.mock('../../src/data/account');
const account = await import('../../src/data/account');
const { db, ME_KEY } = await import('../../src/data/db');
const { AppRoutes } = await import('../../src/App');

const TRAINER_TOKEN = 'a'.repeat(32);
const HANDLER_TOKEN = 'b'.repeat(32);
const NEW_TOKEN = 'c'.repeat(32);
const base = (role: string, token: string) => `${window.location.origin}${import.meta.env.BASE_URL}#/${role}/${token}`;

const member = (id: string, name: string, role: Member['role'], removedAt: string | null = null): Member => ({
  id, unit_id: 'u1', user_id: null, name, role, joined_at: '2026-10-01T00:00:00Z', removed_at: removedAt,
});
const tess = member('mT', 'Tess', 'trainer');
const ana = member('mN', 'Ana', 'trainer');
const hana = member('mA', 'Hana', 'handler');
const paul = member('mP', 'Paul', 'handler');
const old = member('mO', 'Olga', 'handler', '2026-10-04T00:00:00Z');
const meOf = (m: Member): Me => ({ id: m.id, unit_id: m.unit_id, role: m.role, name: m.name });

let online = true;
async function seed(me: Member = tess, others: Member[] = [ana, hana, paul, old]) {
  await db.meta.put({ key: ME_KEY, value: meRecord(me) });
  await db.units.put({ id: 'u1', name: 'Border K9', created_at: '2026-10-01T00:00:00Z' });
  await db.members.bulkPut([me, ...others.filter((m) => m.id !== me.id)]);
}
const renderMembers = (me: Member = tess) =>
  render(<MemoryRouter initialEntries={['/members']}><AppRoutes me={meOf(me)} /></MemoryRouter>);
const rowOf = async (name: string) => within((await screen.findByText(name)).closest('li')!);
const card = async (name: 'Trainer link' | 'Handler link') => within(await screen.findByRole('region', { name }));

let clipboard: { writeText: ReturnType<typeof vi.fn> };
let share: ReturnType<typeof vi.fn> | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  vi.mocked(account.getLinks).mockResolvedValue({ trainer: TRAINER_TOKEN, handler: HANDLER_TOKEN });
  vi.mocked(account.regenerateLink).mockResolvedValue(NEW_TOKEN);
  vi.mocked(account.removeMember).mockResolvedValue(undefined);
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

  it('has no invite code, no account, and no "Make trainer / Make handler" any more', async () => {
    await seed();
    renderMembers();
    await screen.findByText('Hana');
    expect(screen.queryByTestId('invite-code')).toBeNull();
    expect(screen.queryByText(/invite/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Make .* (trainer|handler)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New code' })).toBeNull();
  });

  describe('the two links', () => {
    it('shows a card for the trainer link and one for the handler link, with what each is for', async () => {
      await seed();
      renderMembers();
      const trainer = await card('Trainer link');
      expect(trainer.getByText(/Full control/)).toBeInTheDocument();
      expect(trainer.getByText(/share only with trainers/i)).toBeInTheDocument();
      const handler = await card('Handler link');
      expect(handler.getByText(/choose a dog and add time/i)).toBeInTheDocument();
    });

    it('fetches the links when the screen opens and shows the whole address of each', async () => {
      await seed();
      renderMembers();
      expect(await screen.findByText(base('trainer', TRAINER_TOKEN))).toBeInTheDocument();
      expect(screen.getByText(base('handler', HANDLER_TOKEN))).toBeInTheDocument();
      expect(account.getLinks).toHaveBeenCalledTimes(1);
    });

    it('does not keep the links anywhere on the phone', async () => {
      await seed();
      renderMembers();
      await screen.findByText(base('trainer', TRAINER_TOKEN));
      const stored = JSON.stringify(await Promise.all(db.tables.map((t) => t.toArray())));
      expect(stored).not.toContain(TRAINER_TOKEN);
      expect(stored).not.toContain(HANDLER_TOKEN);
      expect(JSON.stringify(Object.entries(localStorage))).not.toContain(HANDLER_TOKEN);
    });

    it('Copy puts the address on the clipboard and says so', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await card('Handler link')).getByRole('button', { name: 'Copy' }));
      expect(clipboard.writeText).toHaveBeenCalledWith(base('handler', HANDLER_TOKEN));
      expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    });

    it('says what to do when the phone will not copy', async () => {
      await seed();
      clipboard.writeText.mockRejectedValue(new Error('denied'));
      renderMembers();
      await userEvent.click((await card('Trainer link')).getByRole('button', { name: 'Copy' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy. Press and hold the link to copy it.');
    });

    it('Share opens the phone’s share sheet with the address', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await card('Handler link')).getByRole('button', { name: 'Share' }));
      expect(share).toHaveBeenCalledTimes(1);
      expect(share.mock.calls[0][0]).toMatchObject({ url: base('handler', HANDLER_TOKEN) });
    });

    it('closing the share sheet is not an error', async () => {
      await seed();
      share!.mockRejectedValue(new DOMException('cancelled', 'AbortError'));
      renderMembers();
      await userEvent.click((await card('Handler link')).getByRole('button', { name: 'Share' }));
      await waitFor(() => expect(share).toHaveBeenCalled());
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('has no Share button where the browser cannot share', async () => {
      await seed();
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      renderMembers();
      await card('Handler link');
      expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    });

    it('New link asks first: "Everyone using the old link will need the new one."', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await card('Handler link')).getByRole('button', { name: 'New link' }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(dialog.getByText('Everyone using the old link will need the new one.')).toBeInTheDocument();
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(account.regenerateLink).not.toHaveBeenCalled();
      expect(screen.getByText(base('handler', HANDLER_TOKEN))).toBeInTheDocument();
    });

    it('a new handler link replaces the shown one, and the trainer link stays', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await card('Handler link')).getByRole('button', { name: 'New link' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Make new link' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(account.regenerateLink).toHaveBeenCalledWith('handler');
      expect(await screen.findByText(base('handler', NEW_TOKEN))).toBeInTheDocument();
      expect(screen.queryByText(base('handler', HANDLER_TOKEN))).toBeNull();
      expect(screen.getByText(base('trainer', TRAINER_TOKEN))).toBeInTheDocument();
    });

    it('a new trainer link replaces the shown one, and this phone stays in', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await card('Trainer link')).getByRole('button', { name: 'New link' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Make new link' }));
      expect(account.regenerateLink).toHaveBeenCalledWith('trainer');
      expect(await screen.findByText(base('trainer', NEW_TOKEN))).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    });

    it('a refusal keeps the old link on screen and says why', async () => {
      await seed();
      vi.mocked(account.regenerateLink).mockRejectedValue(new Error('trainers only'));
      renderMembers();
      await userEvent.click((await card('Handler link')).getByRole('button', { name: 'New link' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Make new link' }));
      expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toHaveTextContent('Trainers only.');
      expect(screen.getByText(base('handler', HANDLER_TOKEN))).toBeInTheDocument();
    });

    it('when the links cannot be fetched, says so and can try again', async () => {
      await seed();
      vi.mocked(account.getLinks).mockRejectedValueOnce(new TypeError('Failed to fetch'));
      renderMembers();
      expect(await screen.findByRole('alert')).toHaveTextContent('Needs signal to show the links.');
      expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText(base('trainer', TRAINER_TOKEN))).toBeInTheDocument();
    });
  });

  describe('the names', () => {
    it('lists trainers and handlers separately, each active name with Remove, and marks the phone’s own', async () => {
      await seed();
      renderMembers();
      const trainers = within(await screen.findByRole('region', { name: 'Trainers' }));
      expect(trainers.getByText('Tess')).toBeInTheDocument();
      expect(trainers.getByText('Ana')).toBeInTheDocument();
      expect(trainers.queryByText('Hana')).toBeNull();
      const handlers = within(screen.getByRole('region', { name: 'Handlers' }));
      expect(handlers.getByText('Hana')).toBeInTheDocument();
      expect(handlers.getByText('Paul')).toBeInTheDocument();
      expect(handlers.queryByText('Olga')).toBeNull();
      expect((await rowOf('Tess')).getByText('you')).toBeInTheDocument();
      expect((await rowOf('Hana')).getByRole('button', { name: 'Remove Hana' })).toHaveTextContent('Remove');
      expect((await rowOf('Ana')).getByRole('button', { name: 'Remove Ana' })).toBeInTheDocument();
    });

    it('does not offer to remove yourself', async () => {
      await seed();
      renderMembers();
      expect((await rowOf('Tess')).queryByRole('button')).toBeNull();
    });

    it('lists removed names greyed under "Removed", with no buttons', async () => {
      await seed();
      renderMembers();
      const removed = within(await screen.findByRole('region', { name: 'Removed' }));
      const olga = within(removed.getByText('Olga').closest('li')!);
      expect(olga.queryByRole('button')).toBeNull();
      expect(removed.getByText('Olga').closest('li')).toHaveClass('soft'); // greyed in soft ink, which keeps its contrast
    });

    it('has no "Removed" section when nobody was removed', async () => {
      await seed(tess, [hana]);
      renderMembers();
      await screen.findByText('Hana');
      expect(screen.queryByRole('region', { name: 'Removed' })).toBeNull();
    });

    it('asks "Remove Paul? Their past sessions stay in the log." and does nothing on Cancel', async () => {
      await seed();
      renderMembers();
      await userEvent.click((await rowOf('Paul')).getByRole('button', { name: 'Remove Paul' }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(dialog.getByText('Remove Paul? Their past sessions stay in the log.')).toBeInTheDocument();
      expect(dialog.getByText(/also make a new link/i)).toBeInTheDocument();
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(account.removeMember).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('removes after confirmation and moves the name under "Removed"', async () => {
      await seed();
      vi.mocked(account.removeMember).mockImplementation(async (id) => { await db.members.update(id, { removed_at: new Date().toISOString() }); });
      renderMembers();
      await userEvent.click((await rowOf('Paul')).getByRole('button', { name: 'Remove Paul' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove Paul' }));
      await waitFor(() => expect(account.removeMember).toHaveBeenCalledWith('mP'));
      const removed = within(await screen.findByRole('region', { name: 'Removed' }));
      expect(await removed.findByText('Paul')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Handlers' })).queryByText('Paul')).toBeNull();
    });

    it('shows "A unit needs at least one trainer." when the server blocks it', async () => {
      await seed(tess, [ana]);
      vi.mocked(account.removeMember).mockRejectedValue(new Error('a unit needs at least one trainer'));
      renderMembers();
      await userEvent.click((await rowOf('Ana')).getByRole('button', { name: 'Remove Ana' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove Ana' }));
      expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toHaveTextContent('A unit needs at least one trainer.');
      expect((await db.members.get('mN'))!.removed_at).toBeNull();
    });
  });

  describe('with no signal', () => {
    it('disables every link and member button and says "Member changes need signal."', async () => {
      await seed();
      online = false;
      renderMembers();
      await screen.findByText(base('trainer', TRAINER_TOKEN));
      expect(screen.getByText('Member changes need signal.')).toBeInTheDocument();
      for (const b of [
        ...screen.getAllByRole('button', { name: 'New link' }),
        screen.getByRole('button', { name: 'Remove Hana' }),
        screen.getByRole('button', { name: 'Remove Ana' }),
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
      await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Hana' })).toBeEnabled());
      expect(screen.queryByText('Member changes need signal.')).toBeNull();
    });
  });

  describe('roles', () => {
    it('sends a handler who opens /members back to the home screen, with no link in sight', async () => {
      await seed(hana, [tess, paul]);
      renderMembers(hana);
      expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument();
      expect(account.getLinks).not.toHaveBeenCalled();
      expect(screen.queryByRole('region', { name: 'Trainer link' })).toBeNull();
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
