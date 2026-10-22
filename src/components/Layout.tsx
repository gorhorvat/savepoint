import {
  ActionIcon,
  AppShell,
  Badge,
  Group,
  Stack,
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
  IconLogout,
  IconMessageCircle,
  IconMoon,
  IconPlugConnected,
  IconSparkles,
  IconSun,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAutoSync } from '../lib/autoSync';
import { useDetailsBackfill } from '../lib/details';
import { usePlayHistory } from '../lib/history';
import { useAchievementsSync } from '../lib/achievements';
import { useLengthBackfill } from '../lib/lengths';
import { usePriceAlertsSync } from '../lib/alerts';
import { useGenreBackfill } from '../lib/genreLookup';
import { logOut } from '../lib/serverStorage';
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

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }} aria-label="Savepoint home">
      <Group gap={10} wrap="nowrap">
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="8" fill="var(--sp-ink)" />
          <rect x="5" y="9" width="11" height="14" rx="2" fill="var(--sp-steam)" />
          <rect x="17.5" y="9" width="5" height="14" rx="2" fill="var(--sp-playstation)" />
          <rect x="24" y="9" width="3" height="14" rx="1.5" fill="var(--sp-switch)" />
        </svg>
        <Text className="display" fw={700} fz={size * 0.82}>
          savepoint
        </Text>
      </Group>
    </Link>
  );
}

function LogoutButton() {
  return (
    <Tooltip label="Log out">
      <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Log out" onClick={() => void logOut()}>
        <IconLogout size={18} />
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
  const mobile = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const wishCount = useStore((s) => s.wishlist.length);
  const connections = useStore((s) => s.connections);
  const connectedCount = Object.keys(connections).length;
  useAutoSync();
  useGenreBackfill();
  useDetailsBackfill();
  usePlayHistory();
  useAchievementsSync();
  useLengthBackfill();
  usePriceAlertsSync();

  return (
    <AppShell
      padding={mobile ? 'md' : 'xl'}
      header={{ height: 56, collapsed: !mobile }}
      footer={{ height: 64, collapsed: !mobile }}
      navbar={{ width: 236, breakpoint: 'sm', collapsed: { mobile: true } }}
      styles={{
        main: { width: '100%', minWidth: 0, paddingBottom: mobile ? 'calc(64px + 24px)' : undefined },
        navbar: { background: 'var(--sp-shell)', borderColor: 'var(--sp-line)' },
        header: { background: 'var(--sp-shell)', borderColor: 'var(--sp-line)' },
        footer: { background: 'var(--sp-surface)', borderColor: 'var(--sp-line)' },
      }}
    >
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between">
          <Logo />
          <Group gap={4}>
            <Tooltip label="Connected platforms">
              <ActionIcon
                component={Link}
                to="/platforms"
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="Connected platforms"
              >
                <IconPlugConnected size={18} />
              </ActionIcon>
            </Tooltip>
            <SchemeToggle />
            <LogoutButton />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AppShell.Section mb="xl" mt={6} px={6}>
          <Logo />
        </AppShell.Section>
        <AppShell.Section grow>
          <Stack gap={2} component="nav" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className="nav-link">
                <Icon size={19} stroke={1.7} />
                <span style={{ flex: 1 }}>{label}</span>
                {to === '/wishlist' && wishCount > 0 && (
                  <Badge size="sm" variant="light" color="gray" radius="sm" className="num">
                    {wishCount}
                  </Badge>
                )}
              </NavLink>
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section>
          <Stack gap={2}>
            <NavLink to="/platforms" className="nav-link">
              <IconPlugConnected size={19} stroke={1.7} />
              <span style={{ flex: 1 }}>Platforms</span>
              <Text span size="xs" c="dimmed" className="num">
                {connectedCount ? `${connectedCount} linked` : 'Sample data'}
              </Text>
            </NavLink>
            <Group justify="flex-end" gap={4} mt="xs">
              <SchemeToggle />
              <LogoutButton />
            </Group>
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>

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
