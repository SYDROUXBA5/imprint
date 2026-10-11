import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImprintDB, ME_KEY } from '../../src/data/db';
import { DemoWho } from '../../src/dev/demoWho';
import { DEMO_UNIT_NAME, seedDemo } from '../../src/dev/demoSeed';

describe('?demo=who', () => {
  it('shows the Who are you? screen with the demo unit’s handlers as sample names, and no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<DemoWho onEnter={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.getByText(DEMO_UNIT_NAME)).toBeInTheDocument();
    for (const name of ['Jess Okafor', 'Tom Lindqvist', 'Ana Souza']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Add my name' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('tapping a name goes on into the demo app as that handler', async () => {
    const onEnter = vi.fn();
    render(<DemoWho onEnter={onEnter} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tom Lindqvist' }));
    expect(onEnter).toHaveBeenCalledWith('demo-h2');
  });

  it('adding a name goes on too', async () => {
    const onEnter = vi.fn();
    render(<DemoWho onEnter={onEnter} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add my name' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Add and continue' }));
    expect(onEnter).toHaveBeenCalledWith(undefined);
  });
});

describe('seedDemo as a chosen handler', () => {
  let db: ImprintDB;
  beforeEach(async () => { db = new ImprintDB('imprint-demo-who-test'); await db.open(); });
  afterEach(async () => { await db.delete(); });

  it('signs in as the member that was asked for, with the power of the demo role', async () => {
    const me = await seedDemo('handler', { db, memberId: 'demo-h2' });
    expect(me.name).toBe('Tom Lindqvist');
    expect((await db.meta.get(ME_KEY))?.value).toEqual({ unit_id: 'demo-unit', scope: 'handler', member_id: 'demo-h2' });
  });

  it('never lets a handler demo sign in as a trainer name', async () => {
    const me = await seedDemo('handler', { db, memberId: 'demo-t1' });
    expect(me.id).toBe('demo-h1');
  });
});
