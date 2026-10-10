import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareOrDownload } from '../../src/export/share';

const blob = () => new Blob(['hello'], { type: 'text/csv' });
let clicked: { download: string; href: string }[];
let nav: { share?: unknown; canShare?: unknown };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:fake-1'), configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
  nav = {};
  Object.defineProperty(navigator, 'share', { get: () => nav.share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { get: () => nav.canShare, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shareOrDownload', () => {
  it('opens the share sheet with the file when the phone can share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    nav.canShare = vi.fn(() => true);
    nav.share = share;
    expect(await shareOrDownload(blob(), 'imprint-rex.csv')).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0] as { files: File[] };
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe('imprint-rex.csv');
    expect(arg.files[0].type).toBe('text/csv');
    expect(clicked).toHaveLength(0);
    expect((nav.canShare as ReturnType<typeof vi.fn>).mock.calls[0][0].files[0].name).toBe('imprint-rex.csv');
  });

  it('treats the user closing the share sheet as nothing went wrong, and downloads nothing', async () => {
    nav.canShare = () => true;
    nav.share = vi.fn().mockRejectedValue(new DOMException('Share canceled', 'AbortError'));
    await expect(shareOrDownload(blob(), 'a.csv')).resolves.toBe('cancelled');
    expect(clicked).toHaveLength(0);
  });

  it('falls back to a download when sharing fails for another reason', async () => {
    nav.canShare = () => true;
    nav.share = vi.fn().mockRejectedValue(new DOMException('Needs a tap', 'NotAllowedError'));
    expect(await shareOrDownload(blob(), 'a.csv')).toBe('downloaded');
    expect(clicked).toEqual([{ download: 'a.csv', href: 'blob:fake-1' }]);
  });

  it('downloads when the phone cannot share files', async () => {
    nav.canShare = vi.fn(() => false);
    nav.share = vi.fn();
    expect(await shareOrDownload(blob(), 'a.csv')).toBe('downloaded');
    expect(nav.share).not.toHaveBeenCalled();
    expect(clicked).toEqual([{ download: 'a.csv', href: 'blob:fake-1' }]);
  });

  it('downloads when the browser has no Web Share API at all (desktop)', async () => {
    expect(await shareOrDownload(blob(), 'b.pdf')).toBe('downloaded');
    expect(clicked).toEqual([{ download: 'b.pdf', href: 'blob:fake-1' }]);
  });

  it('cleans up: the temporary link leaves the page and the object URL is revoked later', async () => {
    await shareOrDownload(blob(), 'a.csv');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // too early would cancel the download on Safari
    await vi.advanceTimersByTimeAsync(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
  });
});
