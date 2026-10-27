/**
 * The dashboard shell: sidebar, header, and whichever page is routed.
 *
 * The sidebar is permanent on a desktop and a slide-over on a phone. It starts
 * expanded, because a manager arriving at the dashboard should be able to read
 * where they can go rather than decode four icons, and collapses to an icon
 * rail for anyone who wants the width back. That choice is remembered per
 * browser — it is a preference about this screen, not something worth a round
 * trip to the server.
 */

import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Badge, Button, ThemeToggle, cn } from '@suarza/ui';
import {
  BookOpen,
  ChevronLeft,
  LayoutDashboard,
  LogOut,
  FileText,
  ScrollText,
  Menu,
  PanelLeft,
  Truck,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/use-auth.js';

const COLLAPSED_KEY = 'suarza.sidebar.collapsed';

interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  /**
   * The tile the icon sits in.
   *
   * A colour per destination, so the sidebar is found by shape and hue
   * before it is read — seven grey outlines in a column all look like each
   * other. The colours are not data: nothing here is being compared, so they
   * only have to be distinct and to belong to the same family.
   */
  tile: string;
  /** Matched exactly, so /ledger/<customer> does not also light up Dashboard. */
  end?: boolean;
}

const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    description: 'Weighings and revenue',
    icon: LayoutDashboard,
    tile: 'bg-primary/15 text-primary',
    end: true,
  },
  {
    to: '/ledger',
    label: 'Ledger',
    description: 'Customer accounts',
    icon: BookOpen,
    tile: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  {
    to: '/customers',
    label: 'Customers',
    description: 'Names and companies',
    icon: Users,
    tile: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  {
    to: '/vehicle-types',
    label: 'Vehicle types',
    description: 'Rates per vehicle',
    icon: Truck,
    tile: 'bg-brand/15 text-brand',
  },
  {
    to: '/operators',
    label: 'Operators',
    description: 'Who may sign in',
    icon: UserCog,
    tile: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
  {
    to: '/logs',
    label: 'Logs',
    description: 'Shifts and voided slips',
    icon: ScrollText,
    tile: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  },
  {
    to: '/reports',
    label: 'Reports',
    description: 'Per person, per period',
    icon: FileText,
    tile: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  {
    to: '/manager',
    label: 'Manager',
    description: 'Your pocket',
    icon: Wallet,
    tile: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  },
];

/**
 * localStorage throws in a locked-down browser, and a sidebar preference is
 * not worth a blank page — every access is guarded.
 */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function NavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, description, icon: Icon, tile, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          // The native tooltip is the label when there is no room to show it.
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'group relative flex items-center rounded-lg text-sm transition-colors',
              collapsed ? 'h-11 w-11 justify-center' : 'gap-2.5 px-2 py-2',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              {/* The accent bar reads as "you are here" from the corner of the
                  eye, and is the only marker left when the rail is collapsed. */}
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-primary-foreground/70" />
              )}
              {/*
               * The icon in a tile of its own colour, filled rather than
               * drawn: at 18px a hairline outline is the first thing lost
               * on a bright screen in a cabin at noon.
               *
               * On the active row the tile turns to glass — the row is
               * already the brand green, and a coloured square on top of it
               * would be two competing fills.
               */}
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : tile,
                )}
              >
                <Icon
                  className="h-[18px] w-[18px]"
                  /* Filled, with the outline kept thin so the shape still
                     reads at this size rather than becoming a blob. */
                  fill="currentColor"
                  fillOpacity={0.18}
                  strokeWidth={2.25}
                />
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium leading-tight">{label}</span>
                  <span
                    className={cn(
                      'block truncate text-[11px] leading-tight',
                      isActive ? 'text-primary-foreground/75' : 'text-muted-foreground/70',
                    )}
                  >
                    {description}
                  </span>
                </span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarBody({
  collapsed,
  onNavigate,
  onToggle,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  /** Absent on the phone slide-over, which has no collapsed state. */
  onToggle?: () => void;
}) {
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col">
      {!collapsed && (
        <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Menu
        </p>
      )}

      <div className={cn('flex-1', collapsed ? 'px-2 pt-4' : 'px-3 pt-1')}>
        <NavItems collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      <div className={cn('border-t', collapsed ? 'p-2' : 'p-3')}>
        {!collapsed && user && (
          <div className="mb-2 rounded-lg bg-muted/60 px-3 py-2">
            <p className="truncate text-sm font-medium leading-tight">{user.display_name}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{user.role}</p>
          </div>
        )}

        {onToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            className={cn(
              'text-muted-foreground',
              collapsed ? 'h-11 w-11 p-0' : 'w-full justify-start gap-2',
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-[18px] w-[18px]" />
            ) : (
              <>
                <ChevronLeft className="h-[18px] w-[18px]" />
                Collapse
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // A browser that refuses storage still gets a working sidebar; it just
      // forgets the choice on reload.
    }
  }, [collapsed]);

  return (
    <div className="min-h-full bg-muted/40">
      <header className="sticky top-0 z-30 border-b bg-background shadow-sm">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          {/* The logo is the whole identity here — `mr-auto` keeps the controls
              hard right whatever sits between them. */}
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo@3x.png 3x"
            alt="Suarza International"
            className="mr-auto h-12 w-auto shrink-0"
          />

          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
              {user?.role}
            </Badge>
            {/* Beside sign-out rather than buried in a menu: the dashboard is
                read late in the evening as often as it is in daylight. */}
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside
          className={cn(
            'sticky top-[4.25rem] hidden h-[calc(100vh-4.25rem)] shrink-0 border-r bg-background transition-[width] duration-200 lg:block',
            collapsed ? 'w-[4.5rem]' : 'w-60',
          )}
        >
          <SidebarBody collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </aside>

        {/* Phone: a slide-over, dismissed by the backdrop or by navigating. It
            is never collapsed — an icon rail on a phone is just a worse menu. */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-black/40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute left-0 top-0 flex h-full w-64 flex-col bg-background shadow-xl">
              <div className="flex items-center justify-between border-b px-3 py-2.5">
                <span className="text-sm font-semibold">Menu</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                <SidebarBody collapsed={false} onNavigate={() => setMenuOpen(false)} />
              </div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
