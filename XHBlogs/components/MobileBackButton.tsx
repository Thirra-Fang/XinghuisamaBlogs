"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

function parentHref(pathname: string): string | null {
  if (pathname.startsWith('/posts/')) return '/timeline';
  if (pathname.startsWith('/chatter/') && pathname !== '/chatter/') return '/chatter';
  return null;
}

export default function MobileBackButton() {
  const pathname = usePathname();
  const href = parentHref(pathname);

  if (!href) return null;

  return (
    <Link
      href={href}
      // 放在右下角稍微靠上的位置，防止挡住底部的导航转轴
      className="fixed bottom-24 right-4 z-[90] w-11 h-11 flex items-center justify-center bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-xl rounded-full text-slate-700 dark:text-slate-200 active:scale-90 transition-all"
      title="返回上一级"
    >
      <ChevronLeft size={24} />
    </Link>
  );
}
