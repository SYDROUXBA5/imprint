import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/data/account');
const account = await import('../../src/data/account');
const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');

const TOKEN = '0123456789abcdef0123456789abcdef';
const entered = { unit_id: 'u1', unit_name: 'Wells K9', scope: 'handler' as const, names: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(account.enterWithLink).mockResolvedValue(entered);
});

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('Your link'));
  await userEvent.paste(text);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
}

describe('WelcomeScreen (a phone with no access)', () => {
  it('tells a first-time visitor to open the link they were sent, or paste it', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Open the link your trainer sent you, or paste it here.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /dog/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Your link')).toBeInTheDocument();
  });

  it('has no email, password, sign-up or invite code any more', () => {
    render(<WelcomeScreen />);
    for (const label of [/email/i, /password/i, /invite/i, /unit name/i]) expect(screen.queryByLabelText(label)).toBeNull();
    for (const name of [/sign up/i, /sign in/i, /create/i, /join/i]) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('after the link has changed, says so', () => {
    render(<WelcomeScreen lost />);
    expect(screen.getByText('Your link has changed. Ask your trainer for the new one.')).toBeInTheDocument();
    expect(screen.queryByText('Open the link your trainer sent you, or paste it here.')).toBeNull();
    expect(screen.getByLabelText('Your link')).toBeInTheDocument(); // and the new one can be pasted
  });

  it('opens a whole pasted link', async () => {
    render(<WelcomeScreen />);
    await paste(`https://sydrouxba5.github.io/imprint/#/handler/${TOKEN}`);
    expect(account.enterWithLink).toHaveBeenCalledWith(TOKEN);
  });

  it('opens a bare token', async () => {
    render(<WelcomeScreen />);
    await paste(TOKEN);
    expect(account.enterWithLink).toHaveBeenCalledWith(TOKEN);
  });

  it('says what it wants when the paste holds no link, and sends nothing', async () => {
    render(<WelcomeScreen />);
    await paste('hello there');
    expect(await screen.findByRole('alert')).toHaveTextContent("That doesn't look like an Imprint link. Paste the whole link, or just its 32 letters and numbers.");
    expect(account.enterWithLink).not.toHaveBeenCalled();
  });

  it('says so when the link does not work', async () => {
    vi.mocked(account.enterWithLink).mockRejectedValue(new Error('invalid link'));
    render(<WelcomeScreen />);
    await paste(TOKEN);
    expect(await screen.findByRole('alert')).toHaveTextContent("That link doesn't work any more. Ask your trainer for the new one.");
  });

  it('says it needs signal when the network is down, and keeps what was pasted so Open can be pressed again', async () => {
    vi.mocked(account.enterWithLink).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<WelcomeScreen />);
    await paste(TOKEN);
    expect(await screen.findByRole('alert')).toHaveTextContent('Needs signal to open the link.');
    expect(screen.getByLabelText('Your link')).toHaveValue(TOKEN);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(account.enterWithLink).toHaveBeenCalledTimes(2);
  });

  it('a dead link is cleared from the field and is not repeated in any message', async () => {
    vi.mocked(account.enterWithLink).mockRejectedValue(new Error('invalid link'));
    render(<WelcomeScreen />);
    await paste(TOKEN);
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(screen.getByLabelText('Your link')).toHaveValue('');
  });
});
