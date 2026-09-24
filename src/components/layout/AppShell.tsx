'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Header from './Header';
import Sidebar from './Sidebar';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicPortal = pathname === '/login' || pathname?.startsWith('/quote') || pathname?.startsWith('/portal') || pathname?.startsWith('/view');
  const isDepotApplication = pathname === '/depot' || pathname?.startsWith('/depot/');

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (isPublicPortal || isDepotApplication) {
    return (
      <div className="min-h-screen w-full bg-workspace text-ink flex flex-col selection:bg-primary-soft selection:text-ink print:min-h-0 print:bg-white print:overflow-visible">
        {children}
      </div>
    );
  }

  return (
    <div className="h-screen h-[100dvh] flex flex-col bg-workspace text-ink selection:bg-primary-soft selection:text-ink overflow-hidden print:h-auto print:overflow-visible print:bg-white print:block">
      <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
      <div className="flex flex-1 min-h-0 overflow-hidden relative print:overflow-visible print:h-auto print:block">
        <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
        <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden print:overflow-visible print:h-auto print:p-0 print:m-0 print:max-w-none print:block">
          <div className="p-4 sm:p-6 lg:p-7 max-w-[1440px] mx-auto w-full print:p-0 print:m-0 print:max-w-none print:block">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
