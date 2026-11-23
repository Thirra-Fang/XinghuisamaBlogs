"""Conversions shared by the published-article editor's load/save paths."""

import re
from uuid import uuid4

import markdown
from markdown.extensions import Extension
from markdown.inlinepatterns import SimpleTagInlineProcessor
from markdownify import MarkdownConverter


class StrikethroughExtension(Extension):
    def extendMarkdown(self, md):
        # Code spans and fenced blocks are handled before inline formatting.
        md.inlinePatterns.register(
            SimpleTagInlineProcessor(r'(?<!~)(~~)(?=\S)(.+?)(?<=\S)~~(?!~)', 'del'),
            'strikethrough',
            175,
        )


def markdown_to_editor_html(content):
    return markdown.markdown(
        content,
        extensions=['fenced_code', 'tables', 'nl2br', StrikethroughExtension()],
    )


_DISPLAY_MATH_RE = re.compile(r'\$\$(.+?)\$\$', re.DOTALL)
# Inline $...$: not $$, not shell-like "$ git …", and never swallow HTML tags.
_INLINE_MATH_RE = re.compile(
    r'(?<!\$)\$(?![\s$])((?:\\.|[^$<>])+?)\$(?!\$)',
    re.DOTALL,
)
_PRE_BLOCK_RE = re.compile(r'<pre\b[^>]*>.*?</pre>', re.IGNORECASE | re.DOTALL)
_CODE_SPAN_RE = re.compile(r'<code\b[^>]*>.*?</code>', re.IGNORECASE | re.DOTALL)


def _stash_math_segments(text: str, token_prefix: str) -> tuple[str, dict[str, str]]:
    """Replace $...$ / $$...$$ with placeholders so markdownify cannot escape _ inside them."""
    store: dict[str, str] = {}

    def stash(match: re.Match, kind: str) -> str:
        token = f'{token_prefix}{kind}{len(store)}END'
        store[token] = match.group(0)
        return token

    # Protect <pre> and inline <code> so shell `$` / `$ git …` are not treated as math.
    code_store: dict[str, str] = {}

    def stash_code(match: re.Match, kind: str) -> str:
        token = f'{token_prefix}{kind}{len(code_store)}END'
        code_store[token] = match.group(0)
        return token

    work = _PRE_BLOCK_RE.sub(lambda m: stash_code(m, 'PRE'), text)
    work = _CODE_SPAN_RE.sub(lambda m: stash_code(m, 'CODE'), work)
    work = _DISPLAY_MATH_RE.sub(lambda m: stash(m, 'DMATH'), work)
    work = _INLINE_MATH_RE.sub(lambda m: stash(m, 'IMATH'), work)
    # Restore code/pre before markdownify so convert_pre / code spans work as before.
    for token, block in code_store.items():
        work = work.replace(token, block)
    return work, store


def unescape_math_underscores(markdown_text: str) -> str:
    """Inside math delimiters only, turn \\_ into _ (repair / safety net)."""

    def fix_chunk(match: re.Match) -> str:
        return match.group(0).replace('\\_', '_')

    text = _DISPLAY_MATH_RE.sub(fix_chunk, markdown_text)
    text = _INLINE_MATH_RE.sub(fix_chunk, text)
    return text


class EditorMarkdownConverter(MarkdownConverter):
    def __init__(self):
        super().__init__(heading_style='ATX', keep=['img', 'br'])
        self.code_blocks = {}
        self.token_prefix = 'XHCODE' + uuid4().hex

    def convert_pre(self, el, text, parent_tags):
        # Stash code before any prose <br> normalization or Markdown escaping.
        code = el.find('code')
        code_text = (code if code is not None else el).get_text()
        language = ''
        if code is not None:
            language = next(
                (value[9:] for value in code.get('class', [])
                 if value.startswith('language-')),
                '',
            )
        fence_size = max([2] + [len(run) for run in re.findall(r'`+', code_text)]) + 1
        fence = '`' * fence_size
        # A closing fence must start on its own line; retain original indentation.
        body = code_text if code_text.endswith('\n') else code_text + '\n'
        token = self.token_prefix + str(len(self.code_blocks)) + 'END'
        self.code_blocks[token] = f'{fence}{language}\n{body}{fence}'
        return '\n\n' + token + '\n\n'

    def convert_sub(self, el, text, parent_tags):
        return f'<sub>{text}</sub>'

    def convert_sup(self, el, text, parent_tags):
        return f'<sup>{text}</sup>'



def editor_html_to_markdown(content):
    content = re.sub(r'<p>(?:&#12288;)?</p>', '<br><br>', content)
    math_prefix = 'XHMATH' + uuid4().hex
    content, math_blocks = _stash_math_segments(content, math_prefix)
    converter = EditorMarkdownConverter()
    converted = converter.convert(content)
    converted = re.sub(r'<br\s*/?>', '\n\n', converted)
    for token, block in converter.code_blocks.items():
        converted = converted.replace(token, block)
    for token, block in math_blocks.items():
        converted = converted.replace(token, block)
    return unescape_math_underscores(converted)
