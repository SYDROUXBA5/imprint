import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../../src/domain/types';

const account = vi.hoisted(() => ({
  signIn: vi.fn(), signUp: vi.fn(), createUnit: vi.fn(), joinUnit: vi.fn(), loadMe: vi.fn(), hasSession: vi.fn(),
}));
vi.mock('../../src/data/account', () => account);

const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');

const member: Member = { id: 'm1', unit_id: 'u1', user_id: 'a1', name: 'Tess', role: 'trainer', joined_at: '', removed_at: null };

beforeEach(() => {
  vi.resetAllMocks();
  account.hasSession.mockResolvedValue(false);
  account.loadMe.mockResolvedValue(null);
});

async function signInAs(email = 'tess@example.test', password = 'secret-pw') {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('WelcomeScreen', () => {
  it('shows Sign in first, with a drawing and a Sign up tab', async () => {
    render(<WelcomeScreen />);
    expect(await screen.findByRole('button', { name: 'Sign in', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /dog/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('signs in and, with no unit yet, moves on to create or join', async () => {
    account.signIn.mockResolvedValue(undefined);
    render(<WelcomeScreen />);
    await signInAs();
    expect(account.signIn).toHaveBeenCalledWith('tess@example.test', 'secret-pw');
    expect(await screen.findByRole('heading', { name: 'Join or start a unit' })).toBeInTheDocument();
  });

  it('stays out of the way when the account already belongs to a unit', async () => {
    account.signIn.mockResolvedValue(undefined);
    account.loadMe.mockResolvedValue(member);
    render(<WelcomeScreen />);
    await signInAs();
    expect(account.loadMe).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Join or start a unit' })).toBeNull();
  });

  it('says it needs signal when the network is down', async () => {
    account.signIn.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<WelcomeScreen />);
    await signInAs();
    expect(await screen.findByRole('alert')).toHaveTextContent('Needs signal once to sign in.');
  });

  it('passes other sign-in errors through', async () => {
    account.signIn.mockRejectedValue(new Error('Invalid login credentials'));
    render(<WelcomeScreen />);
    await signInAs();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  });

  it('sign up asks for a name and carries it into the unit step', async () => {
    account.signUp.mockResolvedValue(undefined);
    account.hasSession.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    account.createUnit.mockResolvedValue(member);
    render(<WelcomeScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign up' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Tess');
    await signInAs();
    expect(account.signUp).toHaveBeenCalledWith('tess@example.test', 'secret-pw');
    expect(await screen.findByLabelText('Your name')).toHaveValue('Tess');
    await userEvent.type(screen.getByLabelText('Unit name'), 'North K9');
    await userEvent.click(screen.getByRole('button', { name: 'Create unit' }));
    expect(account.createUnit).toHaveBeenCalledWith('North K9', 'Tess');
  });

  it('tells the person to confirm their email when sign up gives no session', async () => {
    account.signUp.mockResolvedValue(undefined);
    account.hasSession.mockResolvedValue(false);
    render(<WelcomeScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign up' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Tess');
    await signInAs();
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
    expect(screen.getByRole('button', { name: 'Sign in', pressed: true })).toBeInTheDocument();
  });

  it('resumes at the unit step when a session already exists', async () => {
    account.hasSession.mockResolvedValue(true);
    render(<WelcomeScreen />);
    expect(await screen.findByRole('heading', { name: 'Join or start a unit' })).toBeInTheDocument();
  });

  describe('unit step', () => {
    async function openJoin() {
      account.hasSession.mockResolvedValue(true);
      render(<WelcomeScreen />);
      await userEvent.click(await screen.findByRole('button', { name: 'Join with a code' }));
    }
    async function fillJoin(code: string) {
      await userEvent.type(screen.getByLabelText('Invite code'), code);
      await userEvent.type(screen.getByLabelText('Your name'), 'Paul');
      await userEvent.click(screen.getByRole('button', { name: 'Join unit' }));
    }

    it('joins with a code and a name', async () => {
      account.joinUnit.mockResolvedValue(member);
      await openJoin();
      await fillJoin('ab3k9z');
      expect(account.joinUnit).toHaveBeenCalledWith('ab3k9z', 'Paul');
    });

    it('explains a wrong code', async () => {
      account.joinUnit.mockRejectedValue(new Error('invalid invite code'));
      await openJoin();
      await fillJoin('ZZZZZZ');
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "That code doesn't match a unit. Ask your trainer for the current code.",
      );
    });

    it('explains an account that already has a unit', async () => {
      account.joinUnit.mockRejectedValue(new Error('already in a unit'));
      await openJoin();
      await fillJoin('AB3K9Z');
      expect(await screen.findByRole('alert')).toHaveTextContent('This account already belongs to a unit.');
    });
  });
});
