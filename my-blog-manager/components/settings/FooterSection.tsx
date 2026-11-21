import { motion } from 'framer-motion';
import { Save, Calendar, LayoutTemplate } from 'lucide-react';

interface FooterSectionProps {
  formData: any;
  handleUpdate: (field: string, value: any) => void;
  pushToQueue: (label: string, key?: string, value?: any) => void;
}

export default function FooterSection({ formData, handleUpdate, pushToQueue }: FooterSectionProps) {
  const buildDate = formData.buildDate || "2026-03-23T00:00:00";

  const saveToQueue = () => {
    pushToQueue('首页底部配置', 'footerConfig', {
      buildDate,
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col gap-6"
    >
      <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/50 dark:border-slate-800/50 rounded-[40px] p-8 shadow-xl">
        <div className="flex justify-between items-center mb-8 border-b border-white/30 dark:border-slate-700/50 pb-6">
          <div>
            <h2 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
              <LayoutTemplate className="text-indigo-500" /> 首页底部设置
            </h2>
            <p className="text-slate-500 text-sm mt-1 font-bold">定义仪表盘的运行时间起点</p>
          </div>
          <button
            onClick={saveToQueue}
            className="px-6 py-3 bg-indigo-500 text-white rounded-2xl font-black text-sm shadow-lg shadow-indigo-500/30 flex items-center gap-2 hover:bg-indigo-600 transition-colors"
          >
            <Save size={16} /> 保存修改
          </button>
        </div>

        <div>
          <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 flex items-center gap-2">
            <Calendar size={14} className="text-indigo-400" /> 建站时间 (起始原点)
          </label>
          <input
            type="datetime-local"
            value={buildDate.slice(0, 16)}
            onChange={(e) => handleUpdate('buildDate', `${e.target.value}:00`)}
            className="w-full bg-white/60 dark:bg-slate-800/60 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 dark:text-slate-200 border border-white/40 dark:border-slate-700/50"
          />
          <p className="text-[10px] text-slate-400 mt-2 ml-1">首页仪表盘的“运行时间”将根据此时间点自动推算。</p>
        </div>
      </div>
    </motion.section>
  );
}
