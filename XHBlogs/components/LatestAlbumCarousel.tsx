// components/LatestAlbumCarousel.tsx
"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';

type AlbumSlide = {
  id: string;
  title: string;
  description: string;
  cover: string;
  date?: string;
};

export default function LatestAlbumCarousel({ albums }: { albums: AlbumSlide[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (albums.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % albums.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [albums.length]);

  if (!albums || albums.length === 0) return null;

  const current = albums[currentIndex];

  return (
    <div className="w-full rounded-3xl bg-white/40 dark:bg-slate-800/50 backdrop-blur-md border border-white/40 dark:border-white/10 shadow-xl overflow-hidden relative group min-h-[200px] sm:min-h-[220px] flex-shrink-0">
      <Link href="/photowall" className="absolute inset-0 z-20" aria-label={`查看相册: ${current.title}`} />

      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.35, ease: "easeInOut" }}
          className="absolute inset-0 z-0"
        >
          <img src={current.cover} className="w-full h-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105" alt={current.title} />
          <div className="absolute inset-0 bg-black/30 dark:bg-black/50 group-hover:bg-black/10 transition-colors duration-300"></div>
        </motion.div>
      </AnimatePresence>

      <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 right-16 z-10 pointer-events-none">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2 underline decoration-pink-400 drop-shadow-md">{current.title}</h3>
        <p className="text-white/90 text-sm sm:text-lg line-clamp-1 drop-shadow-sm">{current.description}</p>
      </div>

      {albums.length > 1 && (
        <div className="absolute bottom-5 right-6 z-30 flex gap-2">
          {albums.map((_, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(i);
              }}
              className={`h-1.5 rounded-full transition-all duration-300 shadow-sm ${i === currentIndex ? 'w-6 bg-pink-400' : 'w-2 bg-white/40 hover:bg-white/80'}`}
              aria-label={`切换到第 ${i + 1} 个相册`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
