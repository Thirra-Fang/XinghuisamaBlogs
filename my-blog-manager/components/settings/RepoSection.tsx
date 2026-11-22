"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '../ToastProvider';
import { storageSet } from '../../lib/safeStorage';
import { ShieldCheck, Save } from 'lucide-react';

export default function RepoSection() {
  const { showToast } = useToast();
  const [isCheckingPath, setIsCheckingPath] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [blogPath, setBlogPath] = useState("");

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configRes = await fetch(`/backend_config.json?t=${Date.now()}`);
        const config = await configRes.json();
        const res = await fetch(`http://127.0.0.1:${config.api_port}/api/deploy/config`);
        if (res.ok) {
          const data = await res.json();
          const path = data.blogPath || "";
          setBlogPath(path);
          if (path) storageSet('targetBlogPath', path);
        }
      } catch (e) { console.error("加载配置失败"); }
    };
    fetchConfig();
  }, []);

  const testPathConnection = async () => {
    if (!blogPath) { showToast("路径不能为空！", "warning"); return; }
    setIsCheckingPath(true);
    try {
      const configRes = await fetch(`/backend_config.json?t=${Date.now()}`);
      const config = await configRes.json();
      const res = await fetch(`http://127.0.0.1:${config.api_port}/api/sync/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogPath })
      });
      const data = await res.json();
      if (data.success) showToast(data.message, "success");
      else showToast(data.message, "error");
    } catch (e) { showToast("无法连接引擎", "error"); }
    setIsCheckingPath(false);
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      const configRes = await fetch(`/backend_config.json?t=${Date.now()}`);
      const config = await configRes.json();
      const res = await fetch(`http://127.0.0.1:${config.api_port}/api/deploy/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogPath })
      });
      const data = await res.json();
      if (data.success) {
        storageSet('targetBlogPath', blogPath);
        showToast(data.message, "success");
      } else {
        showToast(data.message || "保存失败", "error");
      }
    } catch (e) { showToast("保存失败", "error"); }
    setIsSaving(false);
  };

  return (
    <motion.section initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-2xl border border-white/50 dark:border-slate-800/50 rounded-[40px] p-8 shadow-2xl relative z-10">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">🚀 项目仓库</h2>
      </div>

      <div className="space-y-8">
        <div className="bg-slate-50 dark:bg-slate-800/30 p-5 rounded-3xl border border-slate-100 dark:border-slate-700/50">
          <div className="flex justify-between items-center mb-3">
            <label className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase flex items-center gap-1">
              <ShieldCheck size={14} className="text-indigo-500" /> 本地 Blog 物理路径
            </label>
            <button onClick={testPathConnection} disabled={isCheckingPath} className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-3 py-1 rounded-full font-bold hover:bg-indigo-500/20 transition-colors">
              {isCheckingPath ? "探测中..." : "测试路径 ⚡"}
            </button>
          </div>
          <input
            type="text"
            value={blogPath}
            onChange={e => setBlogPath(e.target.value)}
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="/home/…/XinghuisamaBlogs/XHBlogs"
          />
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            「同步 Blog」会把管理端内容镜像到此目录，再构建并上传到 VPS 静态回落站。
          </p>
        </div>

        <button onClick={handleSaveConfig} disabled={isSaving} className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl text-sm font-black shadow-xl active:scale-95 transition-all hover:shadow-2xl hover:-translate-y-1">
          <Save size={18} className="inline mr-2" /> {isSaving ? "正在保存..." : "保存配置"}
        </button>
      </div>
    </motion.section>
  );
}
