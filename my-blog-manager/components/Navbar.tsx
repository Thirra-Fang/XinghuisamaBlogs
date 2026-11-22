"use client";

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useOperations } from '../context/OperationContext';
import { useToast } from './ToastProvider';
import { AlertTriangle } from 'lucide-react';
import { siteConfig } from '../siteConfig';
import { fetchBlogPath, storageGet } from '../lib/safeStorage';

type PublishStatus = 'idle' | 'running' | 'done' | 'error';

export default function Navbar({ previewOnly = false, compact = false }: { previewOnly?: boolean; compact?: boolean }) {
  const [showNav, setShowNav] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isOpBoxOpen, setIsOpBoxOpen] = useState(false);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [targetBlogPath, setTargetBlogPath] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>('idle');
  const [publishPhase, setPublishPhase] = useState('');
  const [publishLogs, setPublishLogs] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isGitPushing, setIsGitPushing] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const pathname = usePathname();
  const { operations, removeOperation, clearOperations } = useOperations();
  const { showToast } = useToast();

  useEffect(() => {
    if (previewOnly) return;
    const loadPath = async () => {
      const path = await fetchBlogPath();
      setTargetBlogPath(path);
    };
    loadPath();
  }, [previewOnly]);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 80) setShowNav(false);
      else setShowNav(true);
      setLastScrollY(currentScrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [publishLogs]);

  // Aligned with static site: no music / moments / tree
  const navLinks = [
    { name: '首页', href: '/' },
    { name: '项目', href: '/projects' },
    { name: '归档', href: '/timeline' },
    { name: '照片墙', href: '/photowall' },
    { name: '杂谈', href: '/chatter' },
    { name: '📝 草稿箱', href: '/drafts' },
    { name: '友链', href: '/friends' },
    { name: '关于', href: '/about' },
    { name: '⚙️ 设置', href: '/settings' },
  ];

  const handleMinimize = () => {
    if (typeof window !== 'undefined' && (window as any).pywebview?.api) {
      (window as any).pywebview.api.minimize_window();
    }
  };
  const handleMaximize = () => {
    if (typeof window !== 'undefined' && (window as any).pywebview?.api) {
      (window as any).pywebview.api.maximize_window();
    }
  };
  const handleClose = () => {
    if (typeof window !== 'undefined' && (window as any).pywebview?.api) {
      (window as any).pywebview.api.close_window();
    }
  };

  const getApiBase = async () => {
    const configRes = await fetch(`/backend_config.json?t=${Date.now()}`);
    const configData = await configRes.json();
    return `http://127.0.0.1:${configData.api_port}`;
  };

  const handleUpdateLocal = async () => {
      if (operations.length === 0) {
        showToast("队列中没有待处理的操作", "warning");
        return;
      }

      try {
        showToast(`🔍 正在准备发送 ${operations.length} 个任务...`, "info");
        const apiBase = await getApiBase();

        for (const op of operations) {
          let apiUrl = '';
          let body = {};

          switch (op.type) {
            case 'sync_photowall':
              apiUrl = `${apiBase}/api/gallery/sync`;
              body = { albums: op.value };
              break;
            case 'sync_friends':
              apiUrl = `${apiBase}/api/friends/sync`;
              body = { friends: op.value };
              break;
            case 'sync_projects':
              apiUrl = `${apiBase}/api/projects/sync`;
              body = { projects: op.value };
              break;
            case 'CONFIG':
              apiUrl = `${apiBase}/api/config/update`;
              body = { updates: op.payload };
              break;
            default:
              apiUrl = `${apiBase}/api/drafts/sync_local`;
              body = { operations: [op] };
              break;
          }

          showToast(`🚀 正在请求后端: ${apiUrl}`, "info");

          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });

          const data = await res.json();
          if (!data.success) {
            showToast(`❌ 任务执行失败: ${data.message}`, "error");
            return;
          }
        }

        showToast("✅ 任务已全部执行，本地数据已写入！", "success");
        clearOperations();
        setIsOpBoxOpen(false);

        setTimeout(() => {
          window.location.reload();
        }, 2000);

      } catch (error: any) {
        showToast(`后端连接异常: ${error.message}`, "error");
      }
    };

  const handleSyncBlogClick = () => {
    if (!targetBlogPath) {
       const fallback = storageGet('targetBlogPath') || "";
       setTargetBlogPath(fallback);
    }
    setIsOpBoxOpen(false);
    setSyncModalOpen(true);
  };

  const appendLog = (line: string) => {
    setPublishLogs(prev => [...prev, line]);
  };

  const executeSyncBlog = async () => {
    setSyncModalOpen(false);
    setPublishOpen(true);
    setPublishStatus('running');
    setPublishPhase('准备中');
    setPublishLogs([]);
    setIsPublishing(true);

    try {
      const apiBase = await getApiBase();
      const res = await fetch(`${apiBase}/api/sync/publish-remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogPath: targetBlogPath })
      });

      if (!res.ok || !res.body) {
        setPublishStatus('error');
        appendLog(`请求失败: HTTP ${res.status}`);
        showToast("无法启动同步与远程部署", "error");
        setIsPublishing(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';

        for (const raw of parts) {
          const line = raw.trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'phase') {
              setPublishPhase(evt.message || evt.phase || '');
              appendLog(`[阶段] ${evt.message || evt.phase}`);
            } else if (evt.type === 'log') {
              appendLog(evt.line ?? '');
            } else if (evt.type === 'done') {
              setPublishStatus('done');
              setPublishPhase(evt.message || '完成');
              appendLog(evt.message || '完成');
              showToast(evt.message || '同步并远程部署完成', 'success');
            } else if (evt.type === 'error') {
              setPublishStatus('error');
              setPublishPhase(evt.message || '失败');
              appendLog(`[错误] ${evt.message || '未知错误'}`);
              showToast(evt.message || '同步失败', 'error');
            }
          } catch {
            appendLog(line);
          }
        }
      }

      if (buffer.trim()) {
        try {
          const evt = JSON.parse(buffer.trim());
          if (evt.type === 'done') {
            setPublishStatus('done');
            showToast(evt.message || '同步并远程部署完成', 'success');
          } else if (evt.type === 'error') {
            setPublishStatus('error');
            showToast(evt.message || '同步失败', 'error');
          }
          appendLog(evt.message || evt.line || buffer.trim());
        } catch {
          appendLog(buffer.trim());
        }
      }

      setPublishStatus(prev => (prev === 'running' ? 'done' : prev));
    } catch (error: any) {
      setPublishStatus('error');
      appendLog(`连接异常: ${error?.message || error}`);
      showToast("无法连接到 Python 桌面核心引擎进行同步", "error");
    } finally {
      setIsPublishing(false);
    }
  };

  const cancelPublish = async () => {
    try {
      const apiBase = await getApiBase();
      await fetch(`${apiBase}/api/sync/publish-cancel`, { method: 'POST' });
      appendLog('[系统] 已请求取消…');
    } catch {
      appendLog('[系统] 取消请求失败');
    }
  };

  const handleGitPush = async () => {
    const message = commitMessage.trim();
    if (!message) {
      showToast('请填写 git commit message', 'warning');
      return;
    }
    setIsGitPushing(true);
    try {
      const apiBase = await getApiBase();
      const res = await fetch(`${apiBase}/api/git/commit-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        setCommitMessage('');
      } else {
        showToast(data.message || 'git 推送失败', 'error');
      }
    } catch (error: any) {
      showToast(`git 推送异常: ${error?.message || error}`, 'error');
    } finally {
      setIsGitPushing(false);
    }
  };

  return (
    <>
      <header className={`w-full fixed top-0 left-0 right-0 z-[100] transition-all duration-500 border-b ${showNav ? 'translate-y-0' : '-translate-y-full'} bg-white/40 dark:bg-slate-900/50 backdrop-blur-xl border-white/20 dark:border-white/5 shadow-sm pywebview-drag-region`}>
        <div className="w-[95%] max-w-7xl mx-auto h-16 flex items-center justify-between px-4 box-border">

          <Link href="/" className="min-w-0 truncate text-xl font-black text-slate-800 dark:text-white tracking-tighter">
            {siteConfig.navTitle}
            <span className="text-indigo-500 mx-1">
              {siteConfig.navSuffix || 'の'}
            </span>
            {siteConfig.navAfter}
          </Link>

          <div className="flex items-center gap-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <nav className="hidden lg:flex gap-8 text-sm font-bold">
              {(compact ? navLinks.filter(link => ['/', '/settings'].includes(link.href)) : navLinks).map((link) => (
                <Link key={link.href} href={link.href} className={`relative whitespace-nowrap py-1 transition-colors ${pathname === link.href ? 'text-indigo-600' : 'text-slate-700 dark:text-slate-200'}`}>
                  {link.name}
                </Link>
              ))}
            </nav>

            <div className="relative">
              <button disabled={previewOnly} title={previewOnly ? '预览副本未连接网站同步与发布' : '待处理操作'} onClick={() => setIsOpBoxOpen(!isOpBoxOpen)} className="relative w-10 h-10 rounded-xl bg-white/50 dark:bg-slate-800/50 flex items-center justify-center text-lg hover:scale-105 transition-all border border-white/20 shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-40">
                📥
                {operations.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border-2 border-white dark:border-slate-900">
                      {operations.length}
                    </span>
                  </span>
                )}
              </button>

              <AnimatePresence>
                {isOpBoxOpen && (
                  <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="absolute right-0 mt-3 w-96 bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-4 z-50 cursor-default">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">待处理操作</h3>
                      <button onClick={clearOperations} className="text-[10px] text-red-500 font-bold hover:underline">清空全部</button>
                    </div>

                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto mb-4 custom-scrollbar">
                      {operations.length === 0 ? (
                        <p className="text-center py-6 text-sm text-slate-400 font-medium">暂无积攒的操作</p>
                      ) : (
                        operations.map(op => (
                          <div key={op.id} className="bg-white/50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700 flex justify-between items-center group">
                            <div className="flex flex-col">
                              <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{op.label}</span>
                              <span className="text-[10px] text-slate-400">{op.timestamp}</span>
                            </div>
                            <button onClick={() => removeOperation(op.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all text-lg">✕</button>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleSyncBlogClick}
                        disabled={isPublishing}
                        className="py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                      >
                        🔄 同步 Blog
                      </button>
                      <button onClick={handleUpdateLocal} className="py-2.5 rounded-xl bg-indigo-500 text-white text-xs font-black shadow-lg shadow-indigo-500/30 hover:bg-indigo-600 transition-colors">
                        🚀 更新本地
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        value={commitMessage}
                        onChange={e => setCommitMessage(e.target.value)}
                        placeholder="git commit message"
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        onClick={handleGitPush}
                        disabled={isGitPushing}
                        className="w-full py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-black shadow-lg shadow-emerald-500/30 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                      >
                        {isGitPushing ? '推送中…' : 'git推送'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-2 ml-2 pl-6 border-l border-slate-300/50 dark:border-slate-600/50">
              <button onClick={handleMinimize} className="w-3.5 h-3.5 rounded-full bg-yellow-400 hover:bg-yellow-500 flex items-center justify-center group transition-colors shadow-sm cursor-pointer z-[101]">
                <span className="opacity-0 group-hover:opacity-100 text-[8px] text-yellow-900 font-black">-</span>
              </button>
              <button onClick={handleMaximize} className="w-3.5 h-3.5 rounded-full bg-green-400 hover:bg-green-500 flex items-center justify-center group transition-colors shadow-sm cursor-pointer z-[101]">
                <span className="opacity-0 group-hover:opacity-100 text-[8px] text-green-900 font-black">+</span>
              </button>
              <button onClick={handleClose} className="w-3.5 h-3.5 rounded-full bg-red-400 hover:bg-red-500 flex items-center justify-center group transition-colors shadow-sm cursor-pointer z-[101]">
                <span className="opacity-0 group-hover:opacity-100 text-[8px] text-red-900 font-black">×</span>
              </button>
            </div>

          </div>
        </div>
      </header>

      <AnimatePresence>
        {syncModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSyncModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[40px] shadow-2xl border border-white/50 p-10 text-center">
              <div className="w-16 h-16 bg-amber-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="text-amber-500" size={32} />
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">同步并部署到 VPS</h3>
              <p className="text-sm text-slate-500 mb-8 leading-relaxed text-balance">
                将管理端数据覆盖到<br />
                <span className="font-bold text-amber-500 break-all">{targetBlogPath}</span>
                <br />
                然后执行静态构建并上传到远端服务器。
                <span className="text-xs opacity-80 text-red-400 font-bold mt-2 block">会清空目标站旧文章/配置，构建与上传可能需要数分钟。</span>
              </p>
              <div className="flex gap-3">
                <button onClick={() => setSyncModalOpen(false)} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-black uppercase transition-colors hover:bg-slate-200 dark:hover:bg-slate-700">取消</button>
                <button onClick={executeSyncBlog} className="flex-1 py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg shadow-amber-500/30 transition-all">确认同步</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {publishOpen && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/50 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl rounded-[32px] shadow-2xl border border-white/50 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">同步与远程部署</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    状态：{publishStatus === 'running' ? '进行中' : publishStatus === 'done' ? '成功' : publishStatus === 'error' ? '失败' : '—'}
                    {publishPhase ? ` · ${publishPhase}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {isPublishing && (
                    <button onClick={cancelPublish} className="px-3 py-2 rounded-xl text-xs font-black bg-red-500/10 text-red-600 hover:bg-red-500/20">
                      取消
                    </button>
                  )}
                  <button
                    onClick={() => !isPublishing && setPublishOpen(false)}
                    disabled={isPublishing}
                    className="px-3 py-2 rounded-xl text-xs font-black bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
                  >
                    关闭
                  </button>
                </div>
              </div>
              <div className="h-80 overflow-y-auto rounded-2xl bg-slate-950 text-emerald-300 font-mono text-[11px] leading-5 p-4 border border-slate-800 custom-scrollbar">
                {publishLogs.length === 0 ? (
                  <p className="text-slate-500">等待日志…</p>
                ) : (
                  publishLogs.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all">{line}</div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
              {isPublishing && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-500" />
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
