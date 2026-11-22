/** Plain-text excerpt for cards: no KaTeX / raw $...$ / heavy Markdown markers. */

export function mdExcerpt(source: string, maxLen = 180): string {
  let text = source.replace(/\r\n/g, '\n');

  // Fenced code → omit
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ');

  // Display then inline math → placeholder
  text = text.replace(/\$\$[\s\S]*?\$\$/g, ' [公式] ');
  text = text.replace(/(?<!\$)\$(?!\$)(?:\\.|[^$])+?\$(?!\$)/g, ' [公式] ');

  // Common MD markers
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)]\([^)]*\)/g, '$1');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}
