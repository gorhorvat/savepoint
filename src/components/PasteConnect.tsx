import { Button, Group, PasswordInput, Stack, Text } from '@mantine/core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Connecting a platform that only lets its own apps sign in (Epic, GOG,
 * Nintendo): Savepoint opens the platform's sign-in page, the user copies what
 * it shows afterwards (a code, a page or a link), and Savepoint reads it from
 * the clipboard or a paste box.
 */
export function PasteConnect({
  intro,
  openLabel,
  openUrl,
  copyHelp,
  pasteLabel,
  pastePlaceholder,
  find,
  notFound,
  note,
  onConnect,
}: {
  intro: ReactNode;
  openLabel: string;
  /** The sign-in page; null while it's being prepared. */
  openUrl: string | null;
  /** What to copy on that page, shown after it was opened. */
  copyHelp: ReactNode;
  pasteLabel: string;
  pastePlaceholder: string;
  /** The value in whatever was copied, or null. */
  find: (text: string) => string | null;
  /** Shown when what was copied has no value in it. */
  notFound: string;
  note: ReactNode;
  onConnect: (value: string) => Promise<void>;
}) {
  const [step, setStep] = useState<'start' | 'copy'>('start');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const connect = useCallback(
    async (text: string) => {
      const found = find(text);
      if (!found) {
        setError(notFound);
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await onConnect(found);
        setValue('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [find, notFound, onConnect],
  );

  const fromClipboard = async () => {
    try {
      await connect(await navigator.clipboard.readText());
    } catch {
      setError('The browser didn’t let Savepoint read the clipboard. Paste it into the box below instead.');
    }
  };

  // Back from the platform's page with the value copied: connect without a
  // click when the browser already allows reading the clipboard.
  useEffect(() => {
    if (step !== 'copy') return;
    const onFocus = async () => {
      try {
        const p = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        if (p.state !== 'granted') return;
        const text = await navigator.clipboard.readText();
        if (find(text)) await connect(text);
      } catch {
        // Not supported here (Firefox, Safari): the button does it.
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [step, connect, find]);

  const noteText = (
    <Text size="xs" c="dimmed">
      {note}
    </Text>
  );

  if (step === 'start') {
    return (
      <Stack gap="sm">
        <Text size="sm">{intro}</Text>
        <Button
          component="a"
          href={openUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          disabled={!openUrl}
          onClick={() => setStep('copy')}
          w="fit-content"
        >
          {openLabel}
        </Button>
        {noteText}
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm">{copyHelp}</Text>
      <Group gap="sm">
        <Button onClick={() => void fromClipboard()} loading={busy}>
          Connect with what I copied
        </Button>
        <Button
          component="a"
          href={openUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          variant="default"
          disabled={busy || !openUrl}
        >
          Open the page again
        </Button>
        <Button variant="subtle" color="gray" onClick={() => setStep('start')} disabled={busy}>
          Back
        </Button>
      </Group>
      <PasswordInput
        label={pasteLabel}
        placeholder={pastePlaceholder}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (find(text)) {
            e.preventDefault();
            void connect(text);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void connect(value);
        }}
        error={error}
        autoComplete="off"
      />
      {noteText}
    </Stack>
  );
}
