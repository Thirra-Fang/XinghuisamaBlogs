import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';

// Sanitize untrusted HTML before trusted plugins generate KaTeX and highlighting.
// Keep the classes consumed by those plugins, not arbitrary HTML attributes.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code || []),
      ['className', 'math-inline', 'math-display', /^language-./],
    ],
    span: [
      ...(defaultSchema.attributes?.span || []),
      ['className', 'math', 'math-inline', 'math-display'],
    ],
  },
};

// Keep fragment links to this document working after the sanitizer prefixes
// IDs. Do not rewrite links to other pages or IDs outside the Markdown.
function fixFragmentLinks() {
  return (tree) => {
    const prefix = schema.clobberPrefix;
    const ids = new Set();
    const links = [];
    function visit(node) {
      if (node.type === 'element') {
        const { id, href } = node.properties;
        if (typeof id === 'string' && id.startsWith(prefix)) ids.add(id);
        if (node.tagName === 'a' && typeof href === 'string' && href.startsWith('#') && href.length > 1) {
          links.push(node);
        }
      }
      if (node.children) node.children.forEach(visit);
    }
    visit(tree);
    for (const link of links) {
      let fragment = link.properties.href.slice(1);
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // Keep malformed escapes literal.
      }
      const id = prefix + fragment;
      if (ids.has(id)) link.properties.href = '#' + encodeURIComponent(id);
    }
  };
}

// Open absolute http(s) links in a new tab (same as friends/projects).
// Applied after sanitize so target/rel are not stripped.
function openExternalLinks() {
  return (tree) => {
    function visit(node) {
      if (node.type === 'element' && node.tagName === 'a') {
        const href = node.properties?.href;
        if (typeof href === 'string' && /^(https?:)?\/\//i.test(href)) {
          node.properties.target = '_blank';
          node.properties.rel = ['noopener', 'noreferrer'];
        }
      }
      if (node.children) node.children.forEach(visit);
    }
    visit(tree);
  };
}

// Fallback for mixed Latin + curly-quote bold like `ai**“自己来选择”**表达` that
// remark-cjk-friendly leaves as literal `**` because `i` is ASCII and `“` is general punctuation.
// Runs on mdast text nodes only, so code blocks, inline code, and math are never touched.
function remarkFixMixedQuoteStrong() {
  const re = /\*\*([“‘][^*\n]+?[”’])\*\*/g;
  return (tree) => {
    function visit(node) {
      if (!node.children) return;
      const nextChildren = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value.includes('**')) {
          re.lastIndex = 0;
          let last = 0;
          let m;
          let matched = false;
          while ((m = re.exec(child.value)) !== null) {
            matched = true;
            if (m.index > last) {
              nextChildren.push({ type: 'text', value: child.value.slice(last, m.index) });
            }
            nextChildren.push({
              type: 'strong',
              children: [{ type: 'text', value: m[1] }],
            });
            last = m.index + m[0].length;
          }
          if (matched) {
            if (last < child.value.length) {
              nextChildren.push({ type: 'text', value: child.value.slice(last) });
            }
            continue;
          }
        }
        visit(child);
        nextChildren.push(child);
      }
      node.children = nextChildren;
    }
    visit(tree);
  };
}

export async function renderMarkdown(content) {
  const processed = await unified()
    .use(remarkParse)
    .use(remarkCjkFriendly)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkFixMixedQuoteStrong)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeSanitize, schema)
    .use(fixFragmentLinks)
    .use(openExternalLinks)
    .use(rehypeHighlight, {
      detect: true,
      ignoreMissing: true,
      subset: ['cpp', 'c', 'python', 'java', 'javascript', 'typescript', 'go', 'rust', 'bash', 'json', 'html', 'css', 'sql', 'xml'],
    })
    .use(rehypeKatex)
    .use(rehypeStringify)
    .process(content);
  return processed.toString();
}
