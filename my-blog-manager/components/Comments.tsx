"use client";

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import 'gitalk/dist/gitalk.css';
import Gitalk from 'gitalk';
import { siteConfig } from '../siteConfig';

export default function Comments() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const cfg = siteConfig.gitalkConfig;
  const enabled = Boolean(cfg?.clientID && cfg?.clientSecret && cfg?.repo && cfg?.owner);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    containerRef.current.innerHTML = '';

    try {
      const gitalk = new Gitalk({
        clientID: cfg.clientID,
        clientSecret: cfg.clientSecret,
        repo: cfg.repo,
        owner: cfg.owner,
        admin: cfg.admin,
        proxy: '/api/github',
        id: (pathname.replace(/\/$/, '') || '/').substring(0, 49),
        distractionFreeMode: false,
      });
      gitalk.render(containerRef.current);
    } catch (e) {
      console.warn('Gitalk render skipped:', e);
    }

    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('code')) {
        url.searchParams.delete('code');
        window.history.replaceState({}, document.title, url.toString());
      }
    } catch {
      /* ignore */
    }
  }, [pathname, enabled, cfg]);

  if (!enabled) return null;

  return (
    <div className="w-full mt-16 relative">
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-indigo-500/10 dark:bg-indigo-500/20 blur-3xl rounded-full pointer-events-none z-0"></div>
      <div ref={containerRef} className="gitalk-container relative z-10" />
    </div>
  );
}
