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
  IconBuildingStore,
  IconChartPie,
  IconDisc,
  IconHeart,
  IconMessageCircle,
  IconMoon,
  IconSettings,
  IconSparkles,
  IconSun,
  IconUsers,
} from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { fetchFriendSummary, FRIENDS_CHANGED } from '../lib/friends';
import { usePublicProfileSync } from '../lib/publicProfile';
import { useAutoSync } from '../lib/autoSync';
import { useDetailsBackfill } from '../lib/details';
import { usePlayHistory } from '../lib/history';
import { useAchievementsSync } from '../lib/achievements';
import { useLengthBackfill } from '../lib/lengths';
import { usePriceAlertsSync } from '../lib/alerts';
import { useGenreBackfill } from '../lib/genreLookup';
import { LevelAvatar } from './ProfileAvatar';
import { useStore } from '../lib/store';

const NAV: { to: string; label: string; short?: string; icon: typeof IconBooks; end?: boolean }[] = [
  { to: '/', label: 'Library', icon: IconBooks, end: true },
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

/** Friends in the header, with the number of friend requests waiting. */
function FriendsButton() {
  const [incoming, setIncoming] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    const check = () =>
      fetchFriendSummary()
        .then((s) => setIncoming(s.incoming))
        .catch(() => {});
    check();
    const timer = setInterval(check, 120_000);
    window.addEventListener(FRIENDS_CHANGED, check);
    return () => {
      clearInterval(timer);
      window.removeEventListener(FRIENDS_CHANGED, check);
    };
  }, [pathname]);
  const label = incoming ? `Friends: ${incoming} ${incoming === 1 ? 'request' : 'requests'}` : 'Friends';
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
        {incoming > 0 && <span className="header-count num">{incoming}</span>}
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
