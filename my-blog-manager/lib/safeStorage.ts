/** WebKit/pywebview may lack localStorage — never throw. */

export function storageGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    const ls = window.localStorage;
    if (!ls) return null;
    return ls.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    const ls = window.localStorage;
    if (!ls) return;
    ls.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Resolve blog path from backend_config + /api/deploy/config; empty if unset. */
export async function fetchBlogPath(): Promise<string> {
  try {
    const configRes = await fetch(`/backend_config.json?t=${Date.now()}`);
    const config = await configRes.json();
    const res = await fetch(`http://127.0.0.1:${config.api_port}/api/deploy/config`);
    if (!res.ok) return storageGet("targetBlogPath") || "";
    const data = await res.json();
    if (data.blogPath) {
      storageSet("targetBlogPath", data.blogPath);
      return data.blogPath as string;
    }
  } catch {
    /* fall through */
  }
  return storageGet("targetBlogPath") || "";
}
