'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) supabase.auth.signInAnonymously();
    });
  }, []);

  return <>{children}</>;
}
