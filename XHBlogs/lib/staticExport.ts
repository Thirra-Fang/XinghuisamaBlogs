/** True when building/serving the nginx static export (AboutVPS fallback). */
export const isStaticExport =
  process.env.NEXT_PUBLIC_STATIC_EXPORT === '1' ||
  process.env.STATIC_EXPORT === '1';
