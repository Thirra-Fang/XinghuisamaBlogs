import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import Navbar from '../../components/Navbar';
import ChatterBoard from './ChatterBoard';
import { siteConfig } from '@/siteConfig';
import { mdExcerpt } from '../../lib/mdExcerpt';


export const metadata = {
  title: "杂谈 | "+ siteConfig.title,
  description: "日常碎片与灵感记录",
};

export default function ChatterPage() {
  // 注意：这里我们假设你的 md 文件放在根目录的 chatters 文件夹里
  const chattersDirectory = path.join(process.cwd(), 'chatters');
  let chatters = [];

  try {
    // 确保文件夹存在
    if (!fs.existsSync(chattersDirectory)) {
      fs.mkdirSync(chattersDirectory);
    }

    const fileNames = fs.readdirSync(chattersDirectory).filter(fileName => fileName.endsWith('.md'));

    chatters = fileNames.map(fileName => {
      const slug = fileName.replace(/\.md$/, '');
      const fileContents = fs.readFileSync(path.join(chattersDirectory, fileName), 'utf8');
      const { data, content } = matter(fileContents);

      return {
        slug,
        title: data.title || '',
        date: data.date || '未知时间',
        tags: data.tags || [],
        mood: data.mood || '',
        cover: data.cover || '',
        content: mdExcerpt(content.replace(/^#+ .*\n/m, ''))
      };
    }).sort((a, b) => (new Date(b.date).getTime() - new Date(a.date).getTime())); // 按时间倒序
  } catch (e) {
    console.error("读取杂谈文件失败:", e);
  }

  return (
    <div className="min-h-screen relative pb-10">
      <Navbar />
      {/* 不包 PageTransition：opacity/transform 祖先会让卡片在 WebKit 下卡透明 */}
      <ChatterBoard chatters={chatters} />
    </div>
  );
}