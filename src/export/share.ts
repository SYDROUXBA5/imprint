export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

const REVOKE_AFTER_MS = 60_000;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not at once: some browsers only start reading the file a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * Hand a file to the phone's share sheet (Files, Mail, WhatsApp, AirDrop) where the browser can share
 * files; otherwise save it as a normal download. Closing the share sheet is not an error.
 */
export async function shareOrDownload(blob: Blob, filename: string): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Anything else (for example Safari wanting a fresh tap): the download still gets the file out.
    }
  }
  download(blob, filename);
  return 'downloaded';
}
