import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { LogOut, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/catalog', label: 'Catalog' },
  { to: '/my-courses', label: 'My Courses' },
];

export function NavBar() {
  const location = useLocation();
  const { user, logout } = useAuthStore();

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/catalog" className="text-lg font-bold tracking-tight">
          1111 School
        </Link>
        <nav className="flex gap-4">
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

        <div className="ml-auto flex items-center gap-3">
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
      </div>
    </header>
  );
}
