"use client";

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../ToastProvider';

type Status = {
  configured?: boolean;
  message?: string;
  public_base?: string;
  count?: number;
  env_path?: string;
};

export default function GallerySection(_props: any) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<{ url: string; name?: string; uploaded_at?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const apiBase = async () => {
    const configRes = await fetch(`/backend_config.json?t=${Date.now()}`);
    const configData = await configRes.json();
    return `http://127.0.0.1:${configData.api_port}`;
  };

  const refresh = async () => {
    try {
      const base = await apiBase();
      const [s, l] = await Promise.all([
        fetch(`${base}/api/picbed/status`).then((r) => r.json()),
        fetch(`${base}/api/picbed/list`).then((r) => r.json()),
      ]);
      setStatus(s);
      setItems(l.items || []);
    } catch {
      setStatus({ configured: false, message: '无法连接本地 Python 引擎' });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleTest = async () => {
    setBusy(true);
    try {
      const base = await apiBase();
      const data = await fetch(`${base}/api/picbed/test`, { method: 'POST' }).then((r) => r.json());
      showToast(data.success ? '✅ R2 连接成功' : `❌ ${data.message}`, data.success ? 'success' : 'error');
      await refresh();
    } catch {
      showToast('无法连接本地 Python 引擎', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-2xl border border-white/50 dark:border-slate-800/50 rounded-[40px] p-8 shadow-2xl"
    >
      <h2 className="text-xl font-black text-slate-800 dark:text-white mb-2">🖼️ Cloudflare R2 图床</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
        凭证只放在本机 <code className="font-mono text-[11px]">~/.config/AboutVPS/r2.env</code>，不会写入站点配置或 git。
        上传走 PutObject（Class A）；列表读本地清单，默认不 List bucket。公网 URL：
        <code className="font-mono text-[11px]"> https://img.thirra.com/…</code>（依赖你已配的缓存规则减 Class B）。
      </p>

      <div className="max-w-2xl space-y-6">
        <div
          className={`p-4 rounded-2xl border text-sm font-bold ${
            status?.configured
              ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
          }`}
        >
          {status?.configured ? '✅ R2 已配置' : '⚠️ 尚未配置'}
          <div className="mt-1 text-xs font-medium opacity-90">{status?.message}</div>
          {status?.env_path && (
            <div className="mt-2 text-[10px] font-mono opacity-70">env: {status.env_path}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleTest}
            disabled={busy}
            className="px-6 py-3 rounded-2xl text-sm font-black bg-pink-500 text-white shadow-lg hover:bg-pink-600 disabled:opacity-50"
          >
            {busy ? '测试中…' : '📡 测试 R2 连接'}
          </button>
          <button
            onClick={refresh}
            className="px-6 py-3 rounded-2xl text-sm font-black bg-indigo-500 text-white shadow-lg hover:bg-indigo-600"
          >
            刷新本地清单
          </button>
        </div>

        <div>
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
            本地上传清单（{items.length}）
          </h3>
          <AnimatePresence>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">还没有记录。在编辑器图床工具上传后会出现在这里。</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {items.slice(0, 40).map((it) => (
                  <li
                    key={it.url}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50"
                  >
                    <img src={it.url} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-200" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate text-slate-700 dark:text-slate-200">{it.name || it.url}</div>
                      <div className="text-[10px] font-mono truncate text-slate-400">{it.url}</div>
                    </div>
                    <button
                      type="button"
                      className="text-[10px] font-black text-indigo-500"
                      onClick={() => {
                        navigator.clipboard.writeText(it.url);
                        showToast('已复制 URL', 'success');
                      }}
                    >
                      复制
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}
