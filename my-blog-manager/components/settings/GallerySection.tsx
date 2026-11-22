"use client";

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../ToastProvider';

type Status = {
  configured?: boolean;
  message?: string;
  public_base?: string;
  count?: number;
  env_path?: string;
};

type BatchItem = {
  id: string;
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  url?: string;
  error?: string;
};

export default function GallerySection(_props: any) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<{ url: string; name?: string; uploaded_at?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const uploadOne = async (base: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${base}/api/picbed/upload`, { method: 'POST', body: form });
    return res.json();
  };

  const runBatch = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      showToast('请选择图片文件', 'warning');
      return;
    }
    if (images.length < files.length) {
      showToast(`已跳过 ${files.length - images.length} 个非图片文件`, 'warning');
    }

    const queue: BatchItem[] = images.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      status: 'pending',
    }));
    setBatch(queue);
    setUploading(true);
    showToast(`开始批量上传 ${images.length} 张…`, 'info');

    let ok = 0;
    let fail = 0;
    try {
      const base = await apiBase();
      for (let i = 0; i < images.length; i++) {
        setBatch((prev) =>
          prev.map((it, idx) => (idx === i ? { ...it, status: 'uploading' } : it))
        );
        try {
          const data = await uploadOne(base, images[i]);
          if (data.success && data.url) {
            ok += 1;
            setBatch((prev) =>
              prev.map((it, idx) =>
                idx === i ? { ...it, status: 'done', url: data.url } : it
              )
            );
          } else {
            fail += 1;
            setBatch((prev) =>
              prev.map((it, idx) =>
                idx === i
                  ? { ...it, status: 'error', error: data.message || '上传失败' }
                  : it
              )
            );
          }
        } catch (e: any) {
          fail += 1;
          setBatch((prev) =>
            prev.map((it, idx) =>
              idx === i
                ? { ...it, status: 'error', error: e?.message || '网络错误' }
                : it
            )
          );
        }
      }
      await refresh();
      showToast(
        fail === 0
          ? `✅ 全部完成：${ok} 张`
          : `完成：成功 ${ok}，失败 ${fail}`,
        fail === 0 ? 'success' : 'warning'
      );
    } catch {
      showToast('无法连接本地 Python 引擎', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list || list.length === 0 || uploading) return;
    void runBatch(Array.from(list));
  };

  const copyBatchUrls = () => {
    const urls = batch.filter((b) => b.status === 'done' && b.url).map((b) => b.url!);
    if (urls.length === 0) {
      showToast('本批还没有成功上传的 URL', 'warning');
      return;
    }
    navigator.clipboard.writeText(urls.join('\n'));
    showToast(`已复制 ${urls.length} 条 URL`, 'success');
  };

  const doneCount = batch.filter((b) => b.status === 'done').length;
  const errorCount = batch.filter((b) => b.status === 'error').length;
  const progress =
    batch.length === 0
      ? 0
      : Math.round(
          ((doneCount + errorCount) / batch.length) * 100
        );

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
            disabled={busy || uploading}
            className="px-6 py-3 rounded-2xl text-sm font-black bg-pink-500 text-white shadow-lg hover:bg-pink-600 disabled:opacity-50"
          >
            {busy ? '测试中…' : '📡 测试 R2 连接'}
          </button>
          <button
            onClick={refresh}
            disabled={uploading}
            className="px-6 py-3 rounded-2xl text-sm font-black bg-indigo-500 text-white shadow-lg hover:bg-indigo-600 disabled:opacity-50"
          >
            刷新本地清单
          </button>
        </div>

        {/* 批量上传 */}
        <div>
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
            批量上传到 R2
          </h3>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              onPickFiles(e.dataTransfer.files);
            }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`w-full min-h-[140px] border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
              isDragging
                ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-900/30'
                : 'border-slate-300/80 dark:border-slate-600/80 hover:bg-white/50 dark:hover:bg-slate-800/40'
            } ${uploading ? 'pointer-events-none opacity-70' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onPickFiles(e.target.files)}
            />
            <div className="text-3xl">{uploading ? '⏳' : '📦'}</div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {uploading ? `上传中 ${doneCount + errorCount}/${batch.length}（${progress}%）` : '点击或拖拽多张图片'}
            </p>
            <p className="text-[10px] text-slate-500">支持一次选多张；将逐张上传到 img.thirra.com</p>
          </div>

          {batch.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyBatchUrls}
                  disabled={doneCount === 0}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-500 text-white disabled:opacity-40"
                >
                  复制本批成功 URL（{doneCount}）
                </button>
                <button
                  type="button"
                  onClick={() => setBatch([])}
                  disabled={uploading}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200 disabled:opacity-40"
                >
                  清空本批记录
                </button>
              </div>
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {batch.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-white/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 text-xs"
                  >
                    <span
                      className={`shrink-0 w-2 h-2 rounded-full ${
                        it.status === 'done'
                          ? 'bg-emerald-500'
                          : it.status === 'error'
                            ? 'bg-red-500'
                            : it.status === 'uploading'
                              ? 'bg-amber-400 animate-pulse'
                              : 'bg-slate-300'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate text-slate-700 dark:text-slate-200">{it.name}</div>
                      {it.url && (
                        <div className="font-mono text-[10px] truncate text-slate-400">{it.url}</div>
                      )}
                      {it.error && (
                        <div className="text-[10px] text-red-500 truncate">{it.error}</div>
                      )}
                    </div>
                    {it.url && (
                      <button
                        type="button"
                        className="text-[10px] font-black text-indigo-500 shrink-0"
                        onClick={() => {
                          navigator.clipboard.writeText(it.url!);
                          showToast('已复制 URL', 'success');
                        }}
                      >
                        复制
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
            本地上传清单（{items.length}）
          </h3>
          <AnimatePresence>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">还没有记录。可在上方批量上传，或在编辑器图床工具单张上传。</p>
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
