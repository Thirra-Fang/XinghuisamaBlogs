/** NetEase Cloud Music brand mark: red disc + white note (matches app icon look). */
export default function NetEaseIcon({ className = "w-4 h-4 md:w-5 md:h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#E60026" />
      {/* Simplified official-style note mark */}
      <path
        fill="#FFFFFF"
        d="M15.2 6.4c-2.35-.45-4.45.85-5.05 2.95-.35 1.25.05 2.5 1.05 3.3v.15l-.15 2.85c-.05 1.9 1.45 3.5 3.35 3.55 1.9.05 3.5-1.45 3.55-3.35.05-1.55-.9-2.9-2.3-3.35v-2.55c1.05.25 1.85 1.1 2.05 2.15l1.7-.35c-.35-2.05-1.95-3.65-4-4.05l.7-2.95-1.7-.4-.75 2.95zm-1.55 4.85v2.7c.85.25 1.45 1.05 1.4 1.95-.05.95-.85 1.7-1.8 1.7-.95 0-1.75-.75-1.75-1.7v-2.55c-.55-.4-.8-1.1-.6-1.8.3-1.05 1.35-1.7 2.45-1.5.35.05.65.2.9.4v.8c-.2-.05-.4-.1-.6-.1-.55 0-1 .35-1.15.85-.15.5.1 1 .5 1.25.15.1.3.15.5.15.1 0 .2 0 .3-.05z"
      />
    </svg>
  );
}
