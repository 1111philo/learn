import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Logo } from '@/components/layout/Logo';

const NAV_ITEMS = [
  { to: '/courses', label: 'Courses' },
  { to: '/portfolio', label: 'Portfolio' },
];

export function NavBar() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Close menu on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <header className="border-b bg-white" ref={menuRef}>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/courses" aria-label="1111 home">
          <Logo className="h-7 w-7" />
        </Link>

        <nav className="hidden sm:flex gap-4" aria-label="Main navigation">
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
            <span className="sr-only sm:not-sr-only">Settings</span>
          </Link>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Log out</span>
          </button>
        </div>

        <button
          className="ml-auto p-2 text-muted-foreground hover:text-foreground sm:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {open && (
        <nav
          className="border-t bg-white px-4 pb-4 pt-3 sm:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-3">
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
            <hr className="border-border" />
            {user && (
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            )}
            <Link
              to="/settings"
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
          </div>
        </nav>
      )}
    </header>
  );
}
