import open from 'open';

/**
 * Opens a file or URL in the default browser.
 * Respects the DBCLI_NO_OPEN environment variable for test environments.
 */
export async function openInBrowser(target: string): Promise<void> {
  if (process.env.DBCLI_NO_OPEN === '1' || process.env.NODE_ENV === 'test') {
    console.log(`[Opener] DBCLI_NO_OPEN is set. Skipping browser launch for: ${target}`);
    return;
  }

  try {
    await open(target);
  } catch (err) {
    console.error(`[Opener] Failed to open ${target}:`, err);
  }
}
