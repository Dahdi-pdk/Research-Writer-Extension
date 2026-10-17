// Penyorot sintaks kecil untuk blok kode berpagar (tanpa pustaka). Seluruh keluaran di-escape: hanya <span class="tk-*"> yang
// dibuat di sini yang menjadi HTML, sehingga aman untuk kode yang tidak tepercaya.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const kw = (words) => `\\b(?:${words.trim().split(/\s+/).join('|')})\\b`;
const END = '(?![\\s\\S])';
const DQ = '"(?:\\\\.|[^"\\\\\\n])*"?';
const SQ = "'(?:\\\\.|[^'\\\\\\n])*'?";
const BT = '`(?:\\\\[\\s\\S]|[^`\\\\])*`?';
const CLIKE_COM = `\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|${END})`;
const NUM = '\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[jJnfFlLuU]*)\\b';
const CALL = '\\b[A-Za-z_$][\\w$]*(?=\\s*\\()';

// [kelas, sumber regex] — urutan = prioritas. Tidak boleh ada grup penangkap di dalam sumber (gunakan (?:...)).
const DEFS = {
  python: { flags: 'g', rules: [
    ['com', '#[^\\n]*'],
    ['str', `(?:\\b[rRbBfFuU]{1,2})?(?:"""[\\s\\S]*?(?:"""|${END})|'''[\\s\\S]*?(?:'''|${END})|${DQ}|${SQ})`],
    ['fn', '@[A-Za-z_][\\w.]*'],
    ['num', NUM],
    ['kw', kw('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case')],
    ['lit', kw('True False None self cls')],
    ['fn', CALL]] },
  js: { flags: 'g', rules: [
    ['com', CLIKE_COM], ['str', `${DQ}|${SQ}|${BT}`], ['num', NUM],
    ['kw', kw('break case catch class const continue debugger default delete do else enum export extends finally for from function if implements import in instanceof interface let new of private protected public readonly return static super switch this throw try type typeof var void while with yield async await as')],
    ['lit', kw('true false null undefined NaN Infinity')], ['fn', CALL]] },
  java: { flags: 'g', rules: [
    ['com', CLIKE_COM], ['str', `${DQ}|${SQ}`], ['num', NUM],
    ['kw', kw('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try var void volatile while record')],
    ['lit', kw('true false null')], ['fn', CALL]] },
  c: { flags: 'gm', rules: [
    ['com', CLIKE_COM], ['kw', '^[ \\t]*#[ \\t]*\\w+'], ['str', `${DQ}|${SQ}`], ['num', NUM],
    ['kw', kw('auto bool break case char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new nullptr operator private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while')],
    ['lit', kw('true false NULL nullptr')], ['fn', CALL]] },
  json: { flags: 'g', rules: [
    ['attr', '"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)'], ['str', DQ], ['num', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'], ['lit', kw('true false null')]] },
  bash: { flags: 'g', rules: [
    ['com', '(?:^|(?<=\\s))#[^\\n]*'], ['str', `${DQ}|'[^']*'?`],
    ['var', '\\$\\{[^}\\n]*\\}?|\\$[A-Za-z_]\\w*|\\$[0-9@#?*!$-]'],
    ['kw', kw('if then else elif fi for in do done while until case esac function return exit break continue local export unset readonly source alias select')],
    ['num', '\\b\\d+\\b']] },
  html: { flags: 'g', rules: [
    ['com', `<!--[\\s\\S]*?(?:-->|${END})`], ['tag', '<\\/?[A-Za-z][\\w:.-]*|\\/?>'], ['str', '"[^"\\n]*"?|\'[^\'\\n]*\'?'], ['attr', '[A-Za-z_:][\\w:.-]*(?=\\s*=)']] },
  css: { flags: 'g', rules: [
    ['com', `\\/\\*[\\s\\S]*?(?:\\*\\/|${END})`], ['str', `${DQ}|${SQ}`], ['kw', '@[\\w-]+'],
    ['num', '#[0-9a-fA-F]{3,8}\\b|-?\\b\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|pt|s|ms|deg)?\\b'], ['attr', '[A-Za-z-]+(?=\\s*:)'], ['fn', '[.#][A-Za-z_][\\w-]*']] },
  sql: { flags: 'gi', rules: [
    ['com', `--[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|${END})`], ['str', "'(?:''|[^'])*'?"], ['num', '\\b\\d+(?:\\.\\d+)?\\b'],
    ['kw', kw('select from where group by order having join left right inner outer full cross on as and or not in is null like between limit offset insert into values update set delete create table alter drop index view distinct union all case when then else end exists primary key foreign references default asc desc with')],
    ['fn', '\\b[A-Za-z_]\\w*(?=\\s*\\()']] },
  r: { flags: 'g', rules: [
    ['com', '#[^\\n]*'], ['str', `${DQ}|${SQ}`], ['num', NUM],
    ['kw', kw('if else for while repeat function return break next in library require')], ['lit', kw('TRUE FALSE NULL NA NaN Inf')], ['fn', CALL]] },
  matlab: { flags: 'g', rules: [
    ['com', '%[^\\n]*'], ['str', `${DQ}|'[^'\\n]*'?`], ['num', NUM],
    ['kw', kw('function end if elseif else for while switch case otherwise return break continue try catch global persistent')], ['fn', CALL]] },
  latex: { flags: 'g', rules: [
    ['com', '%[^\\n]*'], ['str', '\\$\\$[\\s\\S]*?(?:\\$\\$|(?![\\s\\S]))|\\$[^$\\n]*\\$?'], ['kw', '\\\\[A-Za-z@]+\\*?|\\\\[^A-Za-z]']] },
  yaml: { flags: 'gm', rules: [
    ['com', '(?:^|(?<=\\s))#[^\\n]*'], ['attr', '^[ \\t-]*[\\w.-]+(?=\\s*:)'], ['str', `${DQ}|${SQ}`], ['num', '\\b\\d+(?:\\.\\d+)?\\b'], ['lit', kw('true false null yes no')]] },
  diff: { flags: 'gm', rules: [
    ['kw', '^(?:@@[^\\n]*|(?:\\+\\+\\+|---)[^\\n]*)'], ['ins', '^\\+[^\\n]*'], ['del', '^-[^\\n]*']] }
};
const ALIAS = {
  python: 'python', py: 'python', js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js',
  java: 'java', c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cc: 'c', cs: 'java', csharp: 'java', json: 'json', jsonc: 'json',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', html: 'html', xml: 'html', svg: 'html', css: 'css', sql: 'sql',
  r: 'r', matlab: 'matlab', octave: 'matlab', latex: 'latex', tex: 'latex', yaml: 'yaml', yml: 'yaml', diff: 'diff', patch: 'diff'
};

const compiled = new Map();
function compile(name) {
  if (!compiled.has(name)) {
    const d = DEFS[name];
    compiled.set(name, { re: new RegExp(d.rules.map(([, s]) => `(${s})`).join('|'), d.flags), classes: d.rules.map(([c]) => c) });
  }
  return compiled.get(name);
}

export const supportedLanguages = () => Object.keys(ALIAS);
const MAX_CHARS = 60000;

// Mengembalikan HTML ter-escape; bahasa tidak dikenal/terlalu panjang -> teks polos ter-escape.
export function highlight(code, lang) {
  const name = ALIAS[String(lang || '').toLowerCase()];
  if (!name || code.length > MAX_CHARS) return esc(code);
  const { re, classes } = compile(name);
  re.lastIndex = 0;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out += esc(code.slice(last, m.index));
    let cls = null;
    for (let i = 0; i < classes.length; i++) if (m[i + 1] !== undefined) { cls = classes[i]; break; }
    out += cls ? `<span class="tk-${cls}">${esc(m[0])}</span>` : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}
