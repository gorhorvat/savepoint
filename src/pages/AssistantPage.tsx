import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconArrowUp, IconInfoCircle, IconPlayerStop, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Markdown } from '../components/Markdown';
import { WishlistButton } from '../components/WishlistButton';
import { streamAssistant, useServerStatus } from '../lib/api';
import {
  buildContext,
  findMentionedGames,
  findOffCatalogTitles,
  offlineReply,
  wishlistGames,
} from '../lib/assistantContext';
import { ownedPlatforms, useLibrary, type LibraryGame } from '../lib/library';
import { recommend } from '../lib/recommend';
import { useGameResolver, useStore } from '../lib/store';
import { useSuggestionPool } from '../lib/suggestions';
import type { ChatMessage, Game } from '../types';

const STARTERS = [
  'What should I play next on Switch?',
  'Something like Hades, but more relaxing',
  'A long RPG to sink the winter into',
  'Short games I can finish in a weekend',
];

export function AssistantPage() {
  const lib = useLibrary();
  const pool = useSuggestionPool(lib);
  const resolve = useGameResolver();
  const wishlist = useStore((s) => s.wishlist);
  const dismissedIds = useStore((s) => s.dismissed);
  const chat = useStore((s) => s.chat);
  const setChat = useStore((s) => s.setChat);
  // Fresh on every visit: Ollama may have been started since the app loaded.
  const [status, recheck] = useServerStatus(true);
  const live = !!status?.assistant;

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const played = useMemo(() => new Set(lib.map((l) => l.game.id)), [lib]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setInput('');
    const history: ChatMessage[] = [...chat, { role: 'user', content: question }];
    setChat([...history, { role: 'assistant', content: '' }]);

    if (!live) {
      const exclude = new Set([...played, ...dismissedIds]);
      setChat([...history, { role: 'assistant', content: offlineReply(question, lib, exclude, pool.games) }]);
      return;
    }

    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const candidates = recommend(lib, {
      owned: ownedPlatforms(lib),
      exclude: new Set(dismissedIds),
      pool: pool.games,
    }).slice(0, 30);
    const context = buildContext(
      lib,
      wishlistGames(wishlist, resolve),
      wishlistGames(dismissedIds.map((gameId) => ({ gameId, addedAt: '' })), resolve),
      candidates,
    );
    let reply = '';
    try {
      await streamAssistant(
        history,
        context,
        (delta) => {
          reply += delta;
          setChat([...history, { role: 'assistant', content: reply }]);
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
        if (!reply) setChat(history);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Title order={1}>Assistant</Title>
          <Text c="dimmed" mt={6} size="lg">
            Ask for a recommendation. It can see your library, hours, and wishlist.
          </Text>
          {live && status && (
            <Text size="sm" c="dimmed" mt={4}>
              {status.assistantProvider === 'gemini'
                ? `Answers come from Google's ${status.assistantModel}, on Gemini's free tier.`
                : `Answers come from ${status.assistantModel}, running locally with Ollama.`}
            </Text>
          )}
        </div>
        {chat.length > 0 && (
          <Tooltip label="Clear conversation">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={() => setChat([])}
              disabled={busy}
              aria-label="Clear conversation"
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      {status && !live && (
        <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} radius="md">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              {!status.online ? (
                <>The Savepoint server isn't running. Start the app with <Code>npm run dev</Code>.</>
              ) : status.assistantProvider === 'gemini' ? (
                <>
                  Add a free Gemini API key as <Code>GEMINI_API_KEY</Code> in <Code>.env</Code> (get one at
                  aistudio.google.com).
                </>
              ) : !status.ollama.reachable ? (
                <>
                  Savepoint can't reach Ollama at <Code>{status.ollama.url}</Code>. Start Ollama, or add a free Gemini
                  API key as <Code>GEMINI_API_KEY</Code> in <Code>.env</Code>, then check again.
                </>
              ) : (
                <>
                  Ollama is running but doesn't have <Code>{status.ollama.model}</Code> yet. Run{' '}
                  <Code>ollama pull {status.ollama.model}</Code>, then check again.
                </>
              )}{' '}
              Until then, answers come from Savepoint's built-in recommender.
            </Text>
            <Button size="xs" variant="default" onClick={recheck}>
              Check again
            </Button>
          </Stack>
        </Alert>
      )}

      {chat.length === 0 && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Try one of these
          </Text>
          <Group gap="xs">
            {STARTERS.map((s) => (
              <Button key={s} variant="default" radius="xl" size="sm" fw={500} onClick={() => send(s)}>
                {s}
              </Button>
            ))}
          </Group>
        </Stack>
      )}

      <Stack gap="lg" aria-live="polite">
        {chat.map((m, i) =>
          m.role === 'user' ? (
            <Paper
              key={i}
              p="sm"
              px="md"
              radius="lg"
              style={{
                alignSelf: 'flex-end',
                maxWidth: '85%',
                background: 'var(--mantine-primary-color-filled)',
                border: 'none',
                color: 'white',
              }}
            >
              <Text style={{ whiteSpace: 'pre-wrap' }}>{m.content}</Text>
            </Paper>
          ) : (
            <AssistantMessage
              key={i}
              text={m.content}
              pending={busy && i === chat.length - 1}
              exclude={played}
              library={lib}
              pool={pool.games}
            />
          ),
        )}
        <div ref={endRef} />
      </Stack>

      {error && (
        <Alert color="red" variant="light" radius="md" title="The assistant didn't answer">
          {error}
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ position: 'sticky', bottom: 12 }}
      >
        <Paper p={6} radius="xl" shadow="sm">
          <Group gap={6} wrap="nowrap" align="flex-end">
            <Textarea
              aria-label="Ask the assistant"
              placeholder="Ask for something to play"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              autosize
              minRows={1}
              maxRows={5}
              variant="unstyled"
              px="sm"
              style={{ flex: 1 }}
            />
            {busy ? (
              <ActionIcon size={38} radius="xl" variant="default" onClick={stop} aria-label="Stop answer">
                <IconPlayerStop size={18} />
              </ActionIcon>
            ) : (
              <ActionIcon size={38} radius="xl" type="submit" disabled={!input.trim()} aria-label="Send">
                <IconArrowUp size={20} />
              </ActionIcon>
            )}
          </Group>
        </Paper>
      </form>
    </Stack>
  );
}

function SlowStartHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return slow ? (
    <Text size="xs" c="dimmed">
      The first answer takes longer while Ollama loads the model onto your graphics card.
    </Text>
  ) : null;
}

function AssistantMessage({
  text,
  pending,
  exclude,
  library,
  pool,
}: {
  text: string;
  pending: boolean;
  exclude: Set<string>;
  library: LibraryGame[];
  pool: Game[];
}) {
  const mentioned = useMemo(
    () => (pending ? [] : findMentionedGames(text, exclude, pool)),
    [text, pending, exclude, pool],
  );
  const offCatalog = useMemo(
    () => (pending ? [] : findOffCatalogTitles(text, library, pool)),
    [text, pending, library, pool],
  );
  return (
    <Stack gap="sm" style={{ maxWidth: '100%' }}>
      {text ? (
        <Markdown text={text} />
      ) : (
        <Stack gap={4}>
          <Group gap="xs">
            <Loader size="xs" type="dots" />
            <Text size="sm" c="dimmed">
              Looking through your library
            </Text>
          </Group>
          {pending && <SlowStartHint />}
        </Stack>
      )}
      {mentioned.length > 0 && (
        <Stack gap={6}>
          {mentioned.map((g) => (
            <Paper key={g.id} p={8} radius="md">
              <Group gap="sm" wrap="nowrap">
                <Link to={`/game/${g.id}`} aria-hidden tabIndex={-1}>
                  <Cover game={g} width={84} radius={5} />
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Anchor component={Link} to={`/game/${g.id}`} c="inherit" fw={600} size="sm">
                    {g.title}
                  </Anchor>
                  <Text size="xs" c="dimmed" truncate>
                    {[...g.genres, ...g.subgenres].join(', ')}
                  </Text>
                </div>
                <WishlistButton game={g} iconOnly />
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
      {offCatalog.length > 0 && (
        <Text size="xs" c="dimmed">
          Not in Savepoint's suggestions, so platforms and prices aren't checked: {offCatalog.join(', ')}.
        </Text>
      )}
    </Stack>
  );
}
