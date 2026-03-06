import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { CatalogPage } from '@/pages/CatalogPage';
import { CreateCoursePage } from '@/pages/CreateCoursePage';
import { GenerationPage } from '@/pages/GenerationPage';
import { CoursePage } from '@/pages/CoursePage';
import { LessonPage } from '@/pages/LessonPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { AssessmentPage } from '@/pages/AssessmentPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { PortfolioPage } from '@/pages/PortfolioPage';
import { useAuthStore } from '@/stores/auth-store';
import { Loader2 } from 'lucide-react';

function RequireAuth() {
  const { token, loading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public auth routes — no AppShell */}
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        {/* Authenticated routes */}
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/courses" replace />} />
            <Route path="courses" element={<CatalogPage />} />
            <Route path="courses/new" element={<CreateCoursePage />} />
            <Route
              path="courses/:courseId/generate"
              element={<GenerationPage />}
            />
            <Route path="courses/:courseId" element={<CoursePage />}>
              <Route path="lessons/:index" element={<LessonPage />} />
              <Route
                path="lessons/:index/activity/:activityIndex"
                element={<ActivityPage />}
              />
            </Route>
            <Route
              path="courses/:courseId/assessment"
              element={<AssessmentPage />}
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
