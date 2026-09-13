'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- avoids SSR/client theme mismatch on first paint
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={mounted ? (isDark ? 'Switch to light theme' : 'Switch to dark theme') : 'Toggle theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted && !isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
