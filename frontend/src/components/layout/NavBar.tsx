import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import logoSvg from '@/assets/logo.svg';
import { useAuthStore } from '@/stores/auth-store';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const NAV_ITEMS = [
  { to: '/catalog', label: 'Catalog' },
  { to: '/my-courses', label: 'My Courses' },
  { to: '/agent-logs', label: 'Agent Logs' },
];

export function NavBar() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/catalog" className="flex items-center gap-2">
          <img src={logoSvg} alt="1111 School" className="h-8 w-8 rounded" />
          <span className="text-lg font-bold tracking-tight">1111 School</span>
        </Link>

        {/* Desktop nav — hidden on mobile */}
        <nav className="hidden sm:flex gap-4">
          {NAV_ITEMS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'text-sm font-medium transition-colors hover:text-foreground',
                location.pathname.startsWith(to)
                  ? 'text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Desktop right-side controls — hidden on mobile */}
        <div className="ml-auto hidden sm:flex items-center gap-3">
          {user && (
            <span className="text-sm text-muted-foreground">{user.email}</span>
          )}
          <Link
            to="/settings"
            className={cn(
              'inline-flex items-center gap-1 text-sm font-medium transition-colors hover:text-foreground',
              location.pathname === '/settings'
                ? 'text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>

        {/* Mobile hamburger — visible on mobile only */}
        <div className="ml-auto sm:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="Open menu"
                className="p-2 text-muted-foreground hover:text-foreground"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 pt-10">
              <nav className="flex flex-col gap-4 px-4">
                {NAV_ITEMS.map(({ to, label }) => (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'text-sm font-medium transition-colors hover:text-foreground',
                      location.pathname.startsWith(to)
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {label}
                  </Link>
                ))}
                <hr className="border-border" />
                {user && (
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                )}
                <Link
                  to="/settings"
                  onClick={() => setOpen(false)}
                  className={cn(
                    'inline-flex items-center gap-2 text-sm font-medium transition-colors hover:text-foreground',
                    location.pathname === '/settings'
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
                <button
                  onClick={() => { setOpen(false); logout(); }}
                  className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
