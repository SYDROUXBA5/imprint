import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/data/account');
const account = await import('../../src/data/account');
const { WhoAreYouScreen, WhoAreYouView } = await import('../../src/ui/screens/WhoAreYouScreen');

const names = [{ id: 'm2', name: 'Hana' }, { id: 'm1', name: 'Paul' }];
const entered = { unit_id: 'u1', unit_name: 'Wells K9', scope: 'handler' as const, names };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(account.loadNames).mockResolvedValue(entered);
  vi.mocked(account.chooseName).mockResolvedValue(undefined);
  vi.mocked(account.addName).mockResolvedValue(undefined);
  vi.mocked(account.markLost).mockResolvedValue(undefined);
});

describe('WhoAreYouView', () => {
  const view = (over: Partial<Parameters<typeof WhoAreYouView>[0]> = {}) => {
    const onChoose = vi.fn();
    const onAdd = vi.fn();
    render(<WhoAreYouView unitName="Wells K9" scope="handler" names={names} onChoose={onChoose} onAdd={onAdd} {...over} />);
    return { onChoose, onAdd };
  };

  it('asks "Who are you?" and shows every name as a big button, plus "Add my name"', () => {
    view();
    expect(screen.getByRole('heading', { level: 1, name: 'Who are you?' })).toBeInTheDocument();
    for (const n of names) {
      const b = screen.getByRole('button', { name: n.name });
      expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(64);
      expect(parseInt(b.style.fontSize, 10)).toBeGreaterThanOrEqual(22);
    }
    expect(screen.getByRole('button', { name: 'Add my name' })).toBeInTheDocument();
    expect(screen.getByText('Wells K9')).toBeInTheDocument();
  });

  it('says which list this is, so a trainer link and a handler link look different', () => {
    view();
    expect(screen.getByText('Handlers')).toBeInTheDocument();
  });

  it('tapping a name chooses it', async () => {
    const { onChoose } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Paul' }));
    expect(onChoose).toHaveBeenCalledWith('m1');
  });

  it('"Add my name" opens a labelled field; submitting sends the name', async () => {
    const { onAdd } = view();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add my name' }));
    await userEvent.type(screen.getByLabelText('Your name'), '  Sam Ng ');
    await userEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    expect(onAdd).toHaveBeenCalledWith('Sam Ng');
  });

  it('does not send an empty name', async () => {
    const { onAdd } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Add my name' }));
    await userEvent.type(screen.getByLabelText('Your name'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('with nobody on the list yet, the name field is already open', () => {
    view({ names: [] });
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByText(/Nobody is on this list yet/)).toBeInTheDocument();
  });

  it('shows an error, and every button waits while busy', () => {
    view({ error: 'Something went wrong.', busy: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
    expect(screen.getByRole('button', { name: 'Paul' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add my name' })).toBeDisabled();
  });
});

describe('WhoAreYouScreen', () => {
  it('fetches the names of the list this phone entered by and shows them', async () => {
    render(<WhoAreYouScreen scope="handler" />);
    expect(await screen.findByRole('button', { name: 'Hana' })).toBeInTheDocument();
    expect(account.loadNames).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Wells K9')).toBeInTheDocument();
  });

  it('tapping a name signs in under it', async () => {
    render(<WhoAreYouScreen scope="handler" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Paul' }));
    expect(account.chooseName).toHaveBeenCalledWith('m1');
  });

  it('adding a name signs in under it', async () => {
    render(<WhoAreYouScreen scope="handler" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add my name' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    expect(account.addName).toHaveBeenCalledWith('Sam');
  });

  it('explains a name that is already on the list', async () => {
    vi.mocked(account.addName).mockRejectedValue(new Error('name taken'));
    render(<WhoAreYouScreen scope="handler" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add my name' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'paul');
    await userEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is already on the list. Tap it above.');
  });

  it('explains a name that is no longer available, and offers the list again', async () => {
    vi.mocked(account.chooseName).mockRejectedValue(new Error('name not available'));
    render(<WhoAreYouScreen scope="handler" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Paul' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is not on the list any more.');
    await waitFor(() => expect(account.loadNames).toHaveBeenCalledTimes(2));
  });

  it('with no signal, says so and can try again', async () => {
    vi.mocked(account.loadNames).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<WhoAreYouScreen scope="handler" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Needs signal to show the names.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Paul' })).toBeInTheDocument();
  });

  it('a link that has been replaced meanwhile is a lost link: the app is told', async () => {
    vi.mocked(account.loadNames).mockRejectedValue(new Error('invalid link'));
    render(<WhoAreYouScreen scope="handler" />);
    await waitFor(() => expect(account.markLost).toHaveBeenCalledTimes(1));
  });

  it('shows the names it has been given before the answer arrives as nothing, not as an empty list', async () => {
    let release!: (v: typeof entered) => void;
    vi.mocked(account.loadNames).mockReturnValue(new Promise((res) => { release = res; }));
    render(<WhoAreYouScreen scope="trainer" />);
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(within(document.body).queryByText(/Nobody is on this list yet/)).toBeNull();
    release({ ...entered, scope: 'trainer' });
    expect(await screen.findByRole('button', { name: 'Paul' })).toBeInTheDocument();
  });
});
