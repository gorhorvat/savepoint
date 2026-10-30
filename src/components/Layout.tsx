import {
  ActionIcon,
  AppShell,
  Group,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconBooks,
  IconHome,
  IconBuildingStore,
  IconChartPie,
  IconDisc,
  IconHeart,
  IconMessageCircle,
  IconMessages,
  IconMoon,
  IconSettings,
  IconSparkles,
  IconSun,
  IconUsers,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchFriendSummary, fetchGiftSummary, FRIENDS_CHANGED } from '../lib/friends';
import { fetchUnread, messageAlerts, MESSAGES_CHANGED, type UnreadLatest } from '../lib/messages';
import { usePublicProfileSync } from '../lib/publicProfile';
import { useAutoSync } from '../lib/autoSync';
import { useStreamTasteSync } from '../lib/streaming';
import { useDetailsBackfill } from '../lib/details';
import { usePlayHistory } from '../lib/history';
import { useAchievementsSync } from '../lib/achievements';
import { useLengthBackfill } from '../lib/lengths';
import { usePriceAlertsSync } from '../lib/alerts';
import { useGenreBackfill } from '../lib/genreLookup';
import { LevelAvatar } from './ProfileAvatar';
import { useStore } from '../lib/store';

const NAV: { to: string; label: string; short?: string; icon: typeof IconBooks; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/library', label: 'Library', icon: IconBooks },
  { to: '/stats', label: 'My Stats', short: 'Stats', icon: IconChartPie },
  { to: '/discover', label: 'Discover', icon: IconSparkles },
  { to: '/assistant', label: 'Assistant', icon: IconMessageCircle },
  { to: '/wishlist', label: 'Wishlist', icon: IconHeart },
  { to: '/physical', label: 'Physical', icon: IconDisc },
  { to: '/stores', label: 'Stores', icon: IconBuildingStore },
];

/** The save crystal: the glowing gem you save your game at in a JRPG. */
export function Crystal({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M16 2 26 13.5 16 30 6 13.5Z" fill="var(--mantine-color-gold-4)" />
      <path d="M16 2 20.5 13.5 16 30 11.5 13.5Z" fill="var(--mantine-color-gold-2)" />
      <path d="M6 13.5h20" stroke="var(--sp-shell)" strokeWidth="1.5" />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }} aria-label="Savepoint home">
      <Group gap={8} wrap="nowrap">
        <Crystal size={size * 1.25} />
        <Text className="display" fz={size * 1.05} lh={1}>
          savepoint
        </Text>
      </Group>
    </Link>
  );
}

/**
 * Friends in the header, with the number of friend requests and unopened gifts
 * waiting, and a green dot when any friend is online.
 */
function FriendsButton() {
  const [incoming, setIncoming] = useState(0);
  const [online, setOnline] = useState(0);
  const [gifts, setGifts] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    const check = () =>
      Promise.all([
        fetchFriendSummary()
          .then((s) => {
            setIncoming(s.incoming);
            setOnline(s.online ?? 0);
          })
          .catch(() => {}),
        fetchGiftSummary()
          .then((s) => setGifts(s.unopened))
          .catch(() => {}),
      ]);
    check();
    const timer = setInterval(check, 120_000);
    window.addEventListener(FRIENDS_CHANGED, check);
    return () => {
      clearInterval(timer);
      window.removeEventListener(FRIENDS_CHANGED, check);
    };
  }, [pathname]);
  const parts = [
    incoming && `${incoming} ${incoming === 1 ? 'request' : 'requests'}`,
    gifts && `${gifts} ${gifts === 1 ? 'gift' : 'gifts'}`,
  ].filter(Boolean);
  if (online) parts.push(`${online} online`);
  const label = parts.length ? `Friends: ${parts.join(', ')}` : 'Friends';
  const count = incoming + gifts;
  return (
    <Tooltip label={label}>
      <ActionIcon
        component={Link}
        to="/friends"
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={label}
        pos="relative"
      >
        <IconUsers size={20} />
        {count > 0 && <span className="header-count num">{count}</span>}
        {online > 0 && <span className="header-online" aria-hidden />}
      </ActionIcon>
    </Tooltip>
  );
}

/** Messages in the header, with the number of unread messages. */
function MessagesButton() {
  const [unread, setUnread] = useState(0);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // The newest unread message already announced (or there when the app opened).
  const announced = useRef<number | null>(null);

  useEffect(() => {
    const announce = (m: UnreadLatest) => {
      const alerts = messageAlerts(useStore.getState().messageAlerts);
      const chat = `/messages/${m.from.id}`;
      const visible = document.visibilityState === 'visible';
      if (visible && pathname === chat) return; // already reading it
      if (visible && alerts.toast) {
        const id = `message-${m.from.id}`;
        notifications.hide(id);
        notifications.show({
          id,
          title: `New message from ${m.from.username}`,
          message: m.preview || 'Open the chat to read it.',
          icon: <IconMessages size={16} />,
          autoClose: 6000,
          style: { cursor: 'pointer' },
          onClick: () => {
            notifications.hide(id);
            navigate(chat);
          },
        });
      } else if (!visible && alerts.browser && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(`New message from ${m.from.username}`, {
            body: m.preview,
            icon: '/favicon.svg',
            tag: `savepoint-message-${m.from.id}`,
          });
          n.onclick = () => {
            window.focus();
            navigate(chat);
            n.close();
          };
        } catch {
          // Some browsers (Android Chrome) only allow notifications from a service worker.
        }
      }
    };
    const check = () => {
      const visible = document.visibilityState === 'visible';
      // Hidden tabs keep checking only for browser notifications.
      if (!visible && !messageAlerts(useStore.getState().messageAlerts).browser) return;
      fetchUnread()
        .then(({ unread: n, latest }) => {
          setUnread(n);
          if (!latest) {
            announced.current ??= 0;
            return;
          }
          if (announced.current !== null && latest.id > announced.current) announce(latest);
          announced.current = Math.max(announced.current ?? 0, latest.id);
        })
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, 30_000);
    window.addEventListener(MESSAGES_CHANGED, check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener(MESSAGES_CHANGED, check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pathname, navigate]);
  const label = unread ? `Messages: ${unread} unread` : 'Messages';
  return (
    <Tooltip label={label}>
      <ActionIcon
        component={Link}
        to="/messages"
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={label}
        pos="relative"
      >
        <IconMessages size={20} />
        {unread > 0 && <span className="header-count num">{unread}</span>}
      </ActionIcon>
    </Tooltip>
  );
}

function SchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  const next = computed === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip label={`Switch to ${next} mode`}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={`Switch to ${next} mode`}
        onClick={() => setColorScheme(next)}
      >
        {computed === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  // Below this width the tabs move to the bottom of the screen.
  const mobile = useMediaQuery('(max-width: 62em)', false, { getInitialValueInEffect: false });
  const wishCount = useStore((s) => s.wishlist.length);
  useAutoSync();
  useGenreBackfill();
  useDetailsBackfill();
  usePlayHistory();
  useAchievementsSync();
  useLengthBackfill();
  usePriceAlertsSync();
  usePublicProfileSync();
  useStreamTasteSync();

  return (
    <AppShell
      padding={mobile ? 'md' : 'xl'}
      header={{ height: mobile ? 56 : 68 }}
      footer={{ height: 64, collapsed: !mobile }}
      styles={{
        main: { width: '100%', minWidth: 0, paddingBottom: mobile ? 'calc(64px + 24px)' : 64 },
        header: { background: 'var(--sp-shell)', borderBottom: 'none' },
        footer: { background: 'var(--sp-surface)', borderTop: 'none' },
      }}
    >
      <AppShell.Header px={mobile ? 'md' : 'xl'}>
        <Group h="100%" justify="space-between" wrap="nowrap" gap="xl">
          <Logo size={mobile ? 20 : 22} />
          {!mobile && (
            <nav className="top-tabs" aria-label="Main">
              {NAV.map(({ to, label, end }) => (
                <NavLink key={to} to={to} end={end}>
                  {label}
                  {to === '/wishlist' && wishCount > 0 && <span className="tab-count num">{wishCount}</span>}
                </NavLink>
              ))}
            </nav>
          )}
          <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
            <SchemeToggle />
            <MessagesButton />
            <FriendsButton />
            <Tooltip label="Settings">
              <ActionIcon component={Link} to="/settings" variant="subtle" color="gray" size="lg" aria-label="Settings">
                <IconSettings size={20} />
              </ActionIcon>
            </Tooltip>
            <Link to="/profile" className="profile-link" aria-label="Profile">
              <LevelAvatar size={mobile ? 28 : 32} />
            </Link>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>{children}</AppShell.Main>

      <AppShell.Footer>
        <nav className="bottom-nav" aria-label="Main">
          {NAV.map(({ to, label, short, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={22} stroke={1.7} />
              {short ?? label}
            </NavLink>
          ))}
        </nav>
      </AppShell.Footer>
    </AppShell>
  );
}
