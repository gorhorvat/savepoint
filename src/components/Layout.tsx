import {
  ActionIcon,
  AppShell,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconBooks,
  IconBroadcast,
  IconDeviceGamepad2,
  IconHome,
  IconChartPie,
  IconDisc,
  IconHeart,
  IconMessageCircle,
  IconMessages,
  IconMoon,
  IconSettings,
  IconSparkles,
  IconSun,
  IconUser,
  IconUsers,
  IconUsersGroup,
  IconLogout,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { FRIENDS_CHANGED } from '../lib/friends';
import { messageAlerts, MESSAGES_CHANGED, type UnreadLatest } from '../lib/messages';
import { nudgePulse, usePulse } from '../lib/pulse';
import { StillHere } from './StillHere';
import { usePublicProfileSync } from '../lib/publicProfile';
import { useAutoSync } from '../lib/autoSync';
import { useStreamTasteSync } from '../lib/streaming';
import { useDetailsBackfill } from '../lib/details';
import { usePlayHistory } from '../lib/history';
import { useAchievementsSync } from '../lib/achievements';
import { useRaritySync } from '../lib/rarity';
import { useBadgeSync } from '../lib/badges';
import { useQuestCheck } from '../lib/quests';
import { useLengthBackfill } from '../lib/lengths';
import { usePriceAlertsSync } from '../lib/alerts';
import { useGenreBackfill } from '../lib/genreLookup';
import { LevelRing, ProfileAvatar } from './ProfileAvatar';
import { useServerStatus } from '../lib/api';
import { logOut } from '../lib/serverStorage';
import { useXp } from '../lib/xp';
import { useStore } from '../lib/store';

const NAV: { to: string; label: string; short?: string; icon: typeof IconBooks; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/library', label: 'Library', icon: IconBooks },
  { to: '/stats', label: 'My Stats', short: 'Stats', icon: IconChartPie },
  { to: '/discover', label: 'Discover', icon: IconSparkles },
  { to: '/assistant', label: 'Assistant', icon: IconMessageCircle },
  { to: '/wishlist', label: 'My Wishlist', short: 'Wishlist', icon: IconHeart },
  { to: '/physical', label: 'My Shelf', short: 'Shelf', icon: IconDisc },
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
 * Friends in the header: friend requests and gifts waiting (top, yellow) and
 * friends online (bottom, green). The tooltip says which is which.
 */
function FriendsButton() {
  const pulse = usePulse();
  const incoming = pulse?.requests ?? 0;
  const online = pulse?.online ?? 0;
  const gifts = pulse?.gifts ?? 0;
  const parts = [
    incoming && `${incoming} friend ${incoming === 1 ? 'request' : 'requests'}`,
    gifts && `${gifts} ${gifts === 1 ? 'gift' : 'gifts'} to open`,
    online && `${online} online`,
  ].filter(Boolean);
  const label = parts.length ? `Friends: ${parts.join(', ')}` : 'Friends';
  const waiting = incoming + gifts;
  const { pathname } = useLocation();
  const active = pathname.startsWith('/friends') || pathname.startsWith('/leaderboard');
  return (
    <Tooltip label={label}>
      <ActionIcon
        component={Link}
        to={incoming || !gifts ? '/friends' : '/friends#gifts'}
        variant="subtle"
        color={active ? 'gold' : 'gray'}
        size="lg"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`header-icon${active ? ' header-icon--active' : ''}`}
        pos="relative"
      >
        <IconUsers size={20} />
        {waiting > 0 && <span className="header-count num">{waiting}</span>}
        {online > 0 && <span className="header-online num">{online}</span>}
      </ActionIcon>
    </Tooltip>
  );
}

/** Messages in the header, with the number of unread messages. */
function MessagesButton() {
  const pulse = usePulse();
  const unread = pulse?.unread ?? 0;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // The newest unread message already announced (or there when the app opened).
  const announced = useRef<number | null>(null);
  const latest = pulse?.latest ?? null;
  const latestId = latest?.id ?? 0;

  // Anything that changes messages, requests or gifts asks for a fresh pulse.
  useEffect(() => {
    const nudge = () => nudgePulse();
    window.addEventListener(MESSAGES_CHANGED, nudge);
    window.addEventListener(FRIENDS_CHANGED, nudge);
    return () => {
      window.removeEventListener(MESSAGES_CHANGED, nudge);
      window.removeEventListener(FRIENDS_CHANGED, nudge);
    };
  }, []);

  useEffect(() => {
    if (!pulse) return;
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
    if (!latest) {
      announced.current ??= 0;
      return;
    }
    if (announced.current !== null && latestId > announced.current) announce(latest);
    announced.current = Math.max(announced.current ?? 0, latestId);
    // Announce when a newer unread message arrives, not when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId]);
  const label = unread ? `Messages: ${unread} unread` : 'Messages';
  const active = pathname.startsWith('/messages');
  return (
    <Tooltip label={label}>
      <ActionIcon
        component={Link}
        to="/messages"
        variant="subtle"
        color={active ? 'gold' : 'gray'}
        size="lg"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`header-icon${active ? ' header-icon--active' : ''}`}
        pos="relative"
      >
        <IconMessages size={20} />
        {unread > 0 && <span className="header-count num">{unread}</span>}
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * The profile picture opens a menu: Profile, Settings, Platforms, Streaming,
 * Manage users (super admin), light or dark mode, and Log out.
 */
function ProfileMenu({ size }: { size: number }) {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  const [status] = useServerStatus();
  const xp = useXp();
  const { pathname } = useLocation();
  const dark = computed === 'dark';
  const active = ['/profile', '/settings', '/platforms', '/streaming', '/admin'].some((p) => pathname.startsWith(p));
  return (
    <Menu position="bottom-end" width={220} shadow="md" withinPortal>
      <Menu.Target>
        <UnstyledButton
          className={`profile-link header-icon${active ? ' profile-link--active' : ''}`}
          aria-label="Profile menu"
          aria-current={active ? 'page' : undefined}
        >
          <LevelRing size={size} level={xp.level} progress={(xp.into / xp.needed) * 100}>
            <ProfileAvatar size={size} />
          </LevelRing>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          Level {xp.level}, {xp.rank}
        </Menu.Label>
        <Menu.Item component={Link} to="/profile" leftSection={<IconUser size={16} />}>
          Profile
        </Menu.Item>
        <Menu.Item component={Link} to="/settings" leftSection={<IconSettings size={16} />}>
          Settings
        </Menu.Item>
        <Menu.Item component={Link} to="/platforms" leftSection={<IconDeviceGamepad2 size={16} />}>
          Platforms
        </Menu.Item>
        <Menu.Item component={Link} to="/streaming" leftSection={<IconBroadcast size={16} />}>
          Streaming
        </Menu.Item>
        {status?.superAdmin && (
          <Menu.Item component={Link} to="/admin" leftSection={<IconUsersGroup size={16} />}>
            Manage users
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item
          leftSection={dark ? <IconSun size={16} /> : <IconMoon size={16} />}
          onClick={() => setColorScheme(dark ? 'light' : 'dark')}
        >
          {dark ? 'Light mode' : 'Dark mode'}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => void logOut()}>
          Log out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  // Below this width the tabs move to the bottom of the screen.
  const mobile = useMediaQuery('(max-width: 62em)', false, { getInitialValueInEffect: false });
  // Games on the wishlist, digital or physical (one per game, like the Wishlist page's cards).
  const wishCount = useStore(
    (s) => new Set([...s.wishlist.map((w) => w.gameId), ...s.physicalWants.map((w) => w.gameId ?? w.title)]).size,
  );
  useAutoSync();
  useGenreBackfill();
  useDetailsBackfill();
  usePlayHistory();
  useAchievementsSync();
  useRaritySync();
  useBadgeSync();
  useQuestCheck();
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
            <MessagesButton />
            <FriendsButton />
            <ProfileMenu size={mobile ? 28 : 32} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>{children}</AppShell.Main>
      <StillHere />

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
