// The TV screens in older TV browsers.
//
// Tailwind 4 writes CSS for browsers from 2023 on (Chrome 111+), but a TV keeps
// the engine it shipped with: apps on an LG TV from 2021 run Chrome 79, from
// 2022 Chrome 87, and even 2024 models run Chrome 108. Those engines throw away whole blocks of
// Tailwind's output (cascade layers, :is()/:where() selectors, the separate
// translate/scale/rotate properties), so the TV screens came out unstyled.
//
// After the build, this rewrites the TV stylesheet (only that one: the desktop
// app's WebView is modern) into CSS that Chrome 79 understands:
//   - Lightning CSS lowers colours, logical properties, `inset` and media
//     ranges, and adds -webkit- prefixes;
//   - cascade layers are unwrapped in order (Tailwind already writes them in
//     priority order);
//   - :is() and :where() selectors are written out in full;
//   - translate/scale/rotate get a `transform` to fall back on;
//   - Tailwind's starting values for its --tw-* variables apply everywhere,
//     for engines without @property;
//   - flex rows and columns get margins where the engine ignores their `gap`.

import { createHash } from 'node:crypto';
import { transform } from 'lightningcss';
import postcss, { type AtRule, type ChildNode, type Root, type Rule } from 'postcss';
import type { Plugin } from 'vite';

/**
 * The oldest engine the TV screens are written for: apps on LG's 2021 TVs
 * (webOS 6) run Chrome 79. The build lowers the TV screens' script to it too.
 */
export const TV_CHROME = 79;

export function legacyCss(css: string): string {
  const lowered = transform({
    filename: 'tv.css',
    code: new TextEncoder().encode(css),
    minify: true,
    targets: { chrome: TV_CHROME << 16 },
  }).code;
  const root = postcss.parse(new TextDecoder().decode(lowered));
  unwrapLayers(root);
  root.walkRules((rule) => {
    if (!inKeyframes(rule) && /:(is|where)\(/.test(rule.selector)) rule.selector = expandSelectorList(rule.selector);
  });
  lowerLogicalProperties(root);
  addTransformFallbacks(root);
  addGradientFallbacks(root);
  addFlexGapFallbacks(root);
  return root.toString();
}

/** After the build: swap the TV stylesheet for the rewritten one, under a new name so TVs don't keep the old copy. */
export function tvLegacyCss(): Plugin {
  return {
    name: 'mm:tv-legacy-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const sheets = Object.values(bundle).filter((o) => o.type === 'asset' && /(^|\/)tv-[^/]*\.css$/.test(o.fileName));
      if (!sheets.length) this.error('The TV stylesheet is missing from the build.');
      for (const sheet of sheets) {
        if (sheet.type !== 'asset') continue;
        const source = legacyCss(String(sheet.source));
        const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
        const old = sheet.fileName;
        const fileName = `${old.slice(0, old.lastIndexOf('/') + 1)}tv-${hash}.css`;
        delete bundle[old];
        this.emitFile({ type: 'asset', fileName, source });
        for (const o of Object.values(bundle)) {
          if (o.type === 'asset' && o.fileName.endsWith('.html')) o.source = String(o.source).split(old).join(fileName);
          else if (o.type === 'chunk' && o.code.includes(old)) o.code = o.code.split(old).join(fileName);
        }
      }
    },
  };
}

// ------------------------------------------------------------------ layers

function unwrapLayers(root: Root) {
  const layers: AtRule[] = [];
  root.walkAtRules('layer', (layer) => {
    layers.push(layer);
  });
  for (const layer of layers.reverse()) {
    // `@layer a, b;` only sets the order.
    if (!layer.nodes) {
      layer.remove();
      continue;
    }
    // Tailwind gives its variables starting values only in a few browsers
    // without @property; older engines need them too.
    if (layer.params === 'properties') {
      layer.walkAtRules('supports', (s) => {
        s.replaceWith(s.nodes ?? []);
      });
    }
    layer.replaceWith(layer.nodes);
  }
}

function inKeyframes(rule: Rule): boolean {
  const p = rule.parent;
  return p?.type === 'atrule' && /keyframes$/.test((p as AtRule).name);
}

// ------------------------------------------------------------------ selectors

/** Write `:is()` and `:where()` out in full: `.a:is(.b, .c)` becomes `.a.b, .a.c`. */
export function expandSelectorList(list: string): string {
  return [...new Set(splitTop(list, ',').flatMap((s) => expandSelector(s)))].join(',');
}

function expandSelector(sel: string): string[] {
  const { compounds, combinators } = parseComplex(sel);
  for (let i = 0; i < compounds.length; i++) {
    const hit = findIsWhere(compounds[i]);
    if (!hit) continue;
    const rest = hit.pre + hit.post;
    const out: string[] = [];
    for (const arg of splitTop(hit.args, ',')) {
      for (const option of expandSelector(arg)) {
        // `X:is(A B)` matches an X that is also a B inside an A: `A XB`.
        const inner = parseComplex(option);
        const last = inner.compounds.length - 1;
        const next = joinComplex(
          [
            ...compounds.slice(0, i),
            ...inner.compounds.slice(0, last),
            merge(rest, inner.compounds[last]),
            ...compounds.slice(i + 1),
          ],
          [...combinators.slice(0, i), ...inner.combinators, ...combinators.slice(i)],
        );
        out.push(...expandSelector(next));
      }
    }
    return out;
  }
  return [sel.trim()];
}

/** Index just past the escape that starts at `i` (a backslash). */
function skipEscape(s: string, i: number): number {
  const hex = /^[0-9a-fA-F]{1,6}/.exec(s.slice(i + 1, i + 7));
  if (!hex) return i + 2;
  const j = i + 1 + hex[0].length;
  // One space after a hex escape ends it (`.\32 xl` is the class "2xl").
  return /\s/.test(s[j] ?? '') ? j + 1 : j;
}

function skipString(s: string, i: number): number {
  const q = s[i];
  let j = i + 1;
  while (j < s.length && s[j] !== q) j = s[j] === '\\' ? j + 2 : j + 1;
  return j + 1;
}

/** Walk `s`, skipping escapes and strings, calling `fn` with each other character's index and the bracket depth. */
function scan(s: string, fn: (i: number, depth: number) => number | void) {
  let depth = 0;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\') {
      i = skipEscape(s, i);
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(s, i);
      continue;
    }
    const jump = fn(i, depth);
    if (typeof jump === 'number') {
      i = jump;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    i++;
  }
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let start = 0;
  scan(s, (i, depth) => {
    if (depth === 0 && s[i] === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  });
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A complex selector as compounds and the combinators between them (' ' for descendant). */
function parseComplex(sel: string): { compounds: string[]; combinators: string[] } {
  const s = sel.trim();
  const compounds: string[] = [];
  const combinators: string[] = [];
  let start = 0;
  scan(s, (i, depth) => {
    if (depth !== 0 || !/[\s>+~]/.test(s[i])) return;
    let j = i;
    let comb = ' ';
    while (j < s.length && /[\s>+~]/.test(s[j])) {
      if (s[j] !== ' ' && /[>+~]/.test(s[j])) comb = s[j];
      j++;
    }
    compounds.push(s.slice(start, i));
    combinators.push(comb);
    start = j;
    return j;
  });
  compounds.push(s.slice(start));
  return { compounds, combinators };
}

function joinComplex(compounds: string[], combinators: string[]): string {
  return compounds.map((c, i) => (i === 0 ? c : (combinators[i - 1] === ' ' ? ' ' : combinators[i - 1]) + c)).join('');
}

/** The first top-level `:is(…)` or `:where(…)` in a compound. */
function findIsWhere(c: string): { pre: string; args: string; post: string } | null {
  let hit: { pre: string; args: string; post: string } | null = null;
  scan(c, (i, depth) => {
    if (hit || depth !== 0 || c[i] !== ':') return;
    const m = /^:(is|where)\(/.exec(c.slice(i));
    if (!m) return;
    const open = i + m[0].length - 1;
    const close = matchParen(c, open);
    hit = { pre: c.slice(0, i), args: c.slice(open + 1, close), post: c.slice(close + 1) };
    return c.length;
  });
  return hit;
}

function matchParen(s: string, open: number): number {
  let close = s.length - 1;
  let found = false;
  scan(s.slice(open), (i, depth) => {
    if (!found && s[open + i] === ')' && depth === 1) {
      close = open + i;
      found = true;
    }
  });
  return close;
}

const PSEUDO_ELEMENT = /^:(:|before\b|after\b|first-line\b|first-letter\b)/;

/** A compound as [type, the rest, pseudo-element]. */
function splitCompound(c: string): [string, string, string] {
  const type = /^(\*|[a-zA-Z][\w-]*)/.exec(c)?.[0] ?? '';
  let at = -1;
  scan(c, (i, depth) => {
    if (at < 0 && i >= type.length && depth === 0 && c[i] === ':' && PSEUDO_ELEMENT.test(c.slice(i))) at = i;
  });
  return at < 0 ? [type, c.slice(type.length), ''] : [type, c.slice(type.length, at), c.slice(at)];
}

/** Two compounds as one: the type first and a pseudo-element last. */
function merge(x: string, a: string): string {
  const [tx, mx, px] = splitCompound(x);
  const [ta, ma, pa] = splitCompound(a);
  const named = (t: string) => (t && t !== '*' ? t : '');
  return named(ta) + named(tx) + mx + ma + px + pa || '*';
}

// ------------------------------------------------------------------ transforms

const TRANSFORM =
  'translate(var(--tw-translate-x,0),var(--tw-translate-y,0)) rotate(var(--tw-fallback-rotate,0deg)) scale(var(--tw-fallback-scale,1))';

/** Engines before Chrome 104 have no `translate`, `scale` or `rotate` properties: use `transform`. */
function addTransformFallbacks(root: Root) {
  const rules: Rule[] = [];
  root.walkRules((rule) => {
    if (!inKeyframes(rule) && rule.some((n) => n.type === 'decl' && /^(translate|scale|rotate)$/.test(n.prop))) {
      rules.push(rule);
    }
  });
  if (!rules.length) return;
  for (const rule of rules) {
    const decls = new Map<string, string>();
    rule.each((n: ChildNode) => {
      if (n.type === 'decl') decls.set(n.prop, n.value);
    });
    const fallback = postcss.rule({ selector: rule.selector });
    const scale = decls.has('scale') ? number(decls.get('--tw-scale-x') ?? decls.get('scale')!.split(/\s+/)[0]) : null;
    if (scale !== null) fallback.append({ prop: '--tw-fallback-scale', value: scale });
    const rotate = decls.get('rotate');
    if (rotate && !rotate.includes('var(')) fallback.append({ prop: '--tw-fallback-rotate', value: rotate });
    fallback.append({ prop: 'transform', value: TRANSFORM });
    rule.after(postcss.atRule({ name: 'supports', params: 'not (translate:0)', nodes: [fallback] }));
  }
  // Set on every element, so a parent's value never leaks into its children.
  root.prepend(
    postcss.rule({
      selector: '*,:before,:after',
      nodes: [
        postcss.decl({ prop: '--tw-fallback-scale', value: '1' }),
        postcss.decl({ prop: '--tw-fallback-rotate', value: '0deg' }),
      ],
    }),
  );
}

// ------------------------------------------------------------------ gradients

const INTERPOLATION = /\s+in\s+ok(lab|lch)\b/;

/**
 * Tailwind's gradients blend "in oklab" (Chrome 111+). That sits in a variable,
 * so an older engine can't skip just that part: the whole gradient goes. Plain
 * gradients first, oklab ones where the engine has them.
 */
function addGradientFallbacks(root: Root) {
  root.walkDecls((d) => {
    const rule = d.parent;
    if (!INTERPOLATION.test(d.value) || rule?.type !== 'rule') return;
    for (let p: postcss.Node | undefined = rule.parent; p; p = p.parent) {
      if (p.type === 'atrule' && (p as AtRule).name === 'supports') return;
    }
    const modern = postcss.rule({ selector: (rule as Rule).selector, nodes: [d.clone()] });
    d.value = d.value.replace(INTERPOLATION, '');
    rule.after(
      postcss.atRule({
        name: 'supports',
        params: '(background-image:linear-gradient(in oklab,red,red))',
        nodes: [modern],
      }),
    );
  });
}

// ------------------------------------------------------------------ logical properties

/** Logical shorthands and the physical sides they set (the TV screens are left-to-right). */
const LOGICAL: Record<string, string[]> = {
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'inset-inline': ['left', 'right'],
  'inset-block': ['top', 'bottom'],
  inset: ['top', 'right', 'bottom', 'left'],
  'padding-inline-start': ['padding-left'],
  'padding-inline-end': ['padding-right'],
  'padding-block-start': ['padding-top'],
  'padding-block-end': ['padding-bottom'],
  'margin-inline-start': ['margin-left'],
  'margin-inline-end': ['margin-right'],
  'margin-block-start': ['margin-top'],
  'margin-block-end': ['margin-bottom'],
  'inset-inline-start': ['left'],
  'inset-inline-end': ['right'],
  'inset-block-start': ['top'],
  'inset-block-end': ['bottom'],
};

/**
 * Tailwind writes `px-4` as `padding-inline` (Chrome 87+). Lightning CSS lowers
 * these only when it can read the value, and Tailwind's values are
 * `calc(var(--spacing) * 4)`, so the rest are written out here.
 */
function lowerLogicalProperties(root: Root) {
  root.walkDecls((d) => {
    const sides = LOGICAL[d.prop];
    if (!sides) return;
    const v = splitTop(d.value, ' ');
    // Like `margin`: a missing value repeats the opposite side's (left takes
    // right's), and one value sets every side.
    const at = (i: number) => v[i] ?? (i === 3 ? (v[1] ?? v[0]) : v[0]);
    sides.forEach((prop, i) => d.cloneBefore({ prop, value: at(i) }));
    d.remove();
  });
}

// ------------------------------------------------------------------ flex gap

/** A single class, like `.gap-4` or `.md\:gap-1\.5`. */
const ONE_CLASS = /^\.(?:\\.|[\w-])+$/;
/** Items that already place themselves: their own margins and absolute positioning win. */
const PLACED_X = ':not(.absolute):not(.fixed):not([class*="ml-"]):not([class*="mx-"])';
const PLACED_Y = ':not(.absolute):not(.fixed):not([class*="mt-"]):not([class*="my-"])';

/**
 * Engines before Chrome 84 ignore `gap` in flex rows and columns (grids are
 * fine). The TV screens mark those engines with `html.no-flex-gap`; there, a
 * margin on every item after the first stands in for the gap. A row that wraps
 * gets no gap between its lines.
 */
function addFlexGapFallbacks(root: Root) {
  const rules: Rule[] = [];
  root.walkRules((rule) => {
    if (!inKeyframes(rule) && ONE_CLASS.test(rule.selector)) rules.push(rule);
  });
  for (const rule of rules) {
    let row: string | undefined;
    let column: string | undefined;
    rule.each((n: ChildNode) => {
      if (n.type !== 'decl') return;
      if (n.prop === 'gap') {
        const [r, c] = splitTop(n.value, ' ');
        row = r;
        column = c ?? r;
      } else if (n.prop === 'row-gap') row = n.value;
      else if (n.prop === 'column-gap') column = n.value;
    });
    const out: Rule[] = [];
    const on = (container: string, item: string) => `html.no-flex-gap ${rule.selector}${container}>*+${item}`;
    if (column) {
      out.push(
        postcss.rule({
          selector: [on('.flex:not(.flex-col)', PLACED_X), on('.inline-flex:not(.flex-col)', PLACED_X)].join(','),
          nodes: [postcss.decl({ prop: 'margin-left', value: column })],
        }),
      );
    }
    if (row) {
      out.push(
        postcss.rule({
          selector: on('.flex-col', PLACED_Y),
          nodes: [postcss.decl({ prop: 'margin-top', value: row })],
        }),
      );
    }
    if (out.length) rule.after(out);
  }
}

/** `110%` or `1.1` as a plain number for `scale()`. */
function number(v: string | undefined): string | null {
  const m = v ? /^(-?[\d.]+)(%?)$/.exec(v.trim()) : null;
  if (!m) return null;
  return m[2] ? String(parseFloat(m[1]) / 100) : m[1];
}
