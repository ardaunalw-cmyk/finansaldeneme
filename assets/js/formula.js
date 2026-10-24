/**
 * A small formula language for custom chart indicators (pro-chart.js) and strategy rules
 * (backtest.js), shared with the tests (test/formula.test.mjs). No DOM, no fetch, no eval: the
 * text is parsed into a tree and the tree is walked.
 *
 *   ema(close, 9) > ema(close, 21) and rsi(close) < 70
 *   crossover(sma(close, 20), sma(close, 50))
 *   (high + low) / 2
 *
 * Values are series over the bars, oldest first: one number (or true/false) per bar, null during
 * an indicator's warm-up. Plain numbers apply to every bar. Prices: open, high, low, close,
 * volume (also acilis, yuksek, dusuk, kapanis, hacim). Operators: + - * /, > < >= <= == !=,
 * and / or / not (also ve / veya / degil, && || !), parentheses. Functions: see FUNCTIONS.
 */
(function (root) {
  const Ind = root.Ind || (typeof require === 'function' ? require('./indicators.js') : null);
  const MAX_LENGTH = 300;

  const PRICES = {
    open: 'open', high: 'high', low: 'low', close: 'close', volume: 'volume',
    acilis: 'open', yuksek: 'high', dusuk: 'low', kapanis: 'close', hacim: 'volume'
  };
  const WORDS = { and: 'and', ve: 'and', or: 'or', veya: 'or', not: 'not', degil: 'not', true: 'true', false: 'false' };

  class FormulaError extends Error {}
  const fail = (msg, pos) => { throw new FormulaError(pos == null ? msg : `${msg} (${pos + 1}. karakter)`); };

  /* ---------- series helpers ---------- */

  const ok = v => v != null && (typeof v === 'boolean' || Number.isFinite(v));
  const map2 = (a, b, f) => a.map((x, i) => (ok(x) && ok(b[i]) ? f(x, b[i]) : null));
  function rolling(a, n, pick) {
    return a.map((_, i) => {
      if (i < n - 1) return null;
      const w = a.slice(i - n + 1, i + 1);
      return w.every(ok) ? pick(...w) : null;
    });
  }
  const shift = (a, n) => a.map((_, i) => (i - n >= 0 && ok(a[i - n]) ? a[i - n] : null));
  /** a crossed b on this bar: at or below on the previous bar, above now (or the reverse). */
  const cross = (a, b, up) => a.map((x, i) => {
    if (!i || ![x, b[i], a[i - 1], b[i - 1]].every(ok)) return null;
    return up ? a[i - 1] <= b[i - 1] && x > b[i] : a[i - 1] >= b[i - 1] && x < b[i];
  });
  const out = a => a.map(v => (ok(v) ? v : null));
  /**
   * Indicator functions want plain numbers from the first bar: they run on the series from its
   * first value on (an indicator of an indicator starts after the inner warm-up), padded back.
   */
  function tail(s, fn) {
    let start = 0;
    while (start < s.length && !ok(s[start])) start++;
    if (start >= s.length) return s.map(() => null);
    return [...new Array(start).fill(null), ...out(fn(s.slice(start).map(v => (ok(v) ? v : NaN))))];
  }

  /**
   * Function table. args: 's' a number series, 'b' a true/false series, 'n' a whole number
   * written in the formula (a period), 'k' any number written in the formula; '?' marks the
   * optional tail, filled from def.
   */
  const FUNCTIONS = {
    sma: { args: ['s', 'n'], ret: 's', help: 'sma(close, 20): basit ortalama', run: (c, [s, n]) => tail(s, a => Ind.sma(a, n)) },
    ema: { args: ['s', 'n'], ret: 's', help: 'ema(close, 9): üssel ortalama', run: (c, [s, n]) => tail(s, a => Ind.ema(a, n)) },
    rsi: { args: ['s', '?n'], def: [null, 14], ret: 's', help: 'rsi(close, 14)', run: (c, [s, n]) => tail(s, a => Ind.rsi(a, n)) },
    macd: { args: ['s', '?n', '?n'], def: [null, 12, 26], ret: 's', help: 'macd(close, 12, 26): MACD çizgisi', run: (c, [s, f, l]) => tail(s, a => Ind.macd(a, f, l, 9).line) },
    macdsignal: { args: ['s', '?n', '?n', '?n'], def: [null, 12, 26, 9], ret: 's', help: 'macdsignal(close, 12, 26, 9)', run: (c, [s, f, l, g]) => tail(s, a => Ind.macd(a, f, l, g).signal) },
    bbupper: { args: ['s', '?n', '?k'], def: [null, 20, 2], ret: 's', help: 'bbupper(close, 20, 2): Bollinger üst bandı', run: (c, [s, n, k]) => tail(s, a => Ind.bollinger(a, n, k).upper) },
    bblower: { args: ['s', '?n', '?k'], def: [null, 20, 2], ret: 's', help: 'bblower(close, 20, 2): Bollinger alt bandı', run: (c, [s, n, k]) => tail(s, a => Ind.bollinger(a, n, k).lower) },
    atr: { args: ['?n'], def: [14], ret: 's', help: 'atr(14): ortalama gerçek aralık', run: (c, [n]) => out(Ind.atrSeries(c.high, c.low, c.close, n)) },    highest: { args: ['s', 'n'], ret: 's', help: 'highest(high, 20): son N mumun en yükseği', run: (c, [s, n]) => rolling(s, n, Math.max) },
    lowest: { args: ['s', 'n'], ret: 's', help: 'lowest(low, 20): son N mumun en düşüğü', run: (c, [s, n]) => rolling(s, n, Math.min) },
    ref: { args: ['s', 'n'], ret: 's', help: 'ref(close, 1): N mum önceki değer', run: (c, [s, n]) => shift(s, n) },
    change: { args: ['s', '?n'], def: [null, 1], ret: 's', help: 'change(close, 1): N mumdaki değişim', run: (c, [s, n]) => map2(s, shift(s, n), (a, b) => a - b) },
    abs: { args: ['s'], ret: 's', help: 'abs(x)', run: (c, [s]) => s.map(v => (ok(v) ? Math.abs(v) : null)) },
    min: { args: ['s', 's'], ret: 's', help: 'min(a, b)', run: (c, [a, b]) => map2(a, b, Math.min) },
    max: { args: ['s', 's'], ret: 's', help: 'max(a, b)', run: (c, [a, b]) => map2(a, b, Math.max) },
    crossover: { args: ['s', 's'], ret: 'b', help: 'crossover(a, b): a, b\'yi yukarı kesti', run: (c, [a, b]) => cross(a, b, true) },
    crossunder: { args: ['s', 's'], ret: 'b', help: 'crossunder(a, b): a, b\'yi aşağı kesti', run: (c, [a, b]) => cross(a, b, false) }
  };

  /* ---------- tokens ---------- */

  function tokenize(text) {
    const src = String(text || '');
    if (!src.trim()) fail('Formül boş');
    if (src.length > MAX_LENGTH) fail(`Formül en fazla ${MAX_LENGTH} karakter olabilir`);
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      const num = /^\d+(\.\d+)?/.exec(src.slice(i));
      if (num) { tokens.push({ t: 'num', v: Number(num[0]), raw: num[0], pos: i }); i += num[0].length; continue; }
      const word = /^[A-Za-z_çğıöşüÇĞİÖŞÜ][A-Za-z0-9_çğıöşüÇĞİÖŞÜ]*/.exec(src.slice(i));
      if (word) {
        // Turkish letters fold to ASCII so "kapanış" and "kapanis" are the same word
        const w = word[0].toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, c => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }[c]));
        tokens.push(WORDS[w] ? { t: 'op', v: WORDS[w], pos: i } : { t: 'id', v: w, pos: i });
        i += word[0].length;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
        tokens.push({ t: 'op', v: { '&&': 'and', '||': 'or' }[two] || two, pos: i });
        i += 2;
        continue;
      }
      if ('+-*/<>(),!'.includes(ch)) { tokens.push({ t: 'op', v: ch === '!' ? 'not' : ch, pos: i }); i++; continue; }
      fail(`Tanınmayan karakter "${ch}"`, i);
    }
    tokens.push({ t: 'end', pos: src.length });
    return tokens;
  }

  /* ---------- parser: or < and < not < comparison < + - < * / < unary - < atom ---------- */

  function parse(text) {
    const tokens = tokenize(text);
    let k = 0;
    const peek = () => tokens[k];
    const isOp = v => peek().t === 'op' && peek().v === v;
    const take = v => { if (!isOp(v)) fail(`"${v}" bekleniyordu`, peek().pos); return tokens[k++]; };

    function binary(next, ops) {
      return () => {
        let left = next();
        while (peek().t === 'op' && ops.includes(peek().v)) {
          const op = tokens[k++];
          left = { kind: 'bin', op: op.v, left, right: next(), pos: op.pos };
        }
        return left;
      };
    }
    function unary() {
      if (isOp('-')) { const op = tokens[k++]; return { kind: 'neg', arg: unary(), pos: op.pos }; }
      return atom();
    }
    function atom() {
      const tok = peek();
      if (tok.t === 'num') { k++; return { kind: 'num', v: tok.v, raw: tok.raw, pos: tok.pos }; }
      if (tok.t === 'op' && (tok.v === 'true' || tok.v === 'false')) { k++; return { kind: 'bool', v: tok.v === 'true', pos: tok.pos }; }
      if (isOp('(')) { k++; const e = or(); take(')'); return e; }
      if (tok.t === 'id') {
        k++;
        if (isOp('(')) {
          k++;
          const args = [];
          if (!isOp(')')) {
            args.push(or());
            while (isOp(',')) { k++; args.push(or()); }
          }
          take(')');
          return { kind: 'call', name: tok.v, args, pos: tok.pos };
        }
        return { kind: 'id', name: tok.v, pos: tok.pos };
      }
      if (tok.t === 'end') fail('Formül yarım kaldı');
      fail(`Beklenmeyen "${tok.v}"`, tok.pos);
    }
    const mul = binary(unary, ['*', '/']);
    const add = binary(mul, ['+', '-']);
    const cmp = binary(add, ['>', '<', '>=', '<=', '==', '!=']);
    function not() {
      if (isOp('not')) { const op = tokens[k++]; return { kind: 'not', arg: not(), pos: op.pos }; }
      return cmp();
    }
    const and = binary(not, ['and']);
    const or = binary(and, ['or']);

    const tree = or();
    if (peek().t !== 'end') fail(`Beklenmeyen "${peek().v}"`, peek().pos);
    return tree;
  }

  /* ---------- types and evaluation ---------- */

  /** Checks types and returns { type: 's' | 'b', run(ctx) -> series }. ctx: { n, open, ..., volume }. */
  function build(node) {
    const want = (n, type, what) => {
      const b = build(n);
      if (b.type !== type) fail(type === 'b' ? `${what} bir koşul (doğru/yanlış) olmalı` : `${what} bir sayı olmalı`, n.pos);
      return b;
    };
    switch (node.kind) {
      case 'num': return { type: 's', run: c => new Array(c.n).fill(node.v) };
      case 'bool': return { type: 'b', run: c => new Array(c.n).fill(node.v) };
      case 'id': {
        const p = PRICES[node.name];
        if (!p) fail(`Bilinmeyen değer "${node.name}" (open, high, low, close, volume kullanılabilir)`, node.pos);
        return { type: 's', run: c => c[p] };
      }
      case 'neg': { const a = want(node.arg, 's', '"-" işaretinin ardından gelen'); return { type: 's', run: c => a.run(c).map(v => (ok(v) ? -v : null)) }; }
      case 'not': { const a = want(node.arg, 'b', '"not" ardından gelen'); return { type: 'b', run: c => a.run(c).map(v => (ok(v) ? !v : null)) }; }
      case 'bin': {
        const { op } = node;
        if (op === 'and' || op === 'or') {
          const a = want(node.left, 'b', `"${op}" solundaki`), b = want(node.right, 'b', `"${op}" sağındaki`);
          return { type: 'b', run: c => map2(a.run(c), b.run(c), op === 'and' ? (x, y) => x && y : (x, y) => x || y) };
        }
        const a = want(node.left, 's', `"${op}" solundaki`), b = want(node.right, 's', `"${op}" sağındaki`);
        const f = {
          '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => (y === 0 ? null : x / y),
          '>': (x, y) => x > y, '<': (x, y) => x < y, '>=': (x, y) => x >= y, '<=': (x, y) => x <= y, '==': (x, y) => x === y, '!=': (x, y) => x !== y
        }[op];
        return { type: '+-*/'.includes(op) ? 's' : 'b', run: c => map2(a.run(c), b.run(c), f).map(v => (ok(v) ? v : null)) };
      }
      case 'call': {
        const def = FUNCTIONS[node.name];
        if (!def) fail(`Bilinmeyen fonksiyon "${node.name}"`, node.pos);
        const required = def.args.filter(a => !a.startsWith('?')).length;
        if (node.args.length < required || node.args.length > def.args.length) {
          fail(`${node.name} ${required === def.args.length ? required : `${required}-${def.args.length}`} değer alır: ${def.help}`, node.pos);
        }
        const parts = def.args.map((spec, i) => {
          const kind = spec.replace('?', '');
          const arg = node.args[i];
          if (!arg) return { constant: def.def[i] };
          if (kind === 'n' || kind === 'k') {
            if (arg.kind !== 'num') fail(`${node.name}: ${i + 1}. değer bir sayı olarak yazılmalı (ör. 20)`, arg.pos);
            if (kind === 'n' && (!Number.isInteger(arg.v) || arg.v < 1 || arg.v > 500)) fail(`${node.name}: periyot 1 ile 500 arasında tam sayı olmalı`, arg.pos);
            return { constant: arg.v };
          }
          return { series: want(arg, kind, `${node.name} fonksiyonunun ${i + 1}. değeri`) };
        });
        return { type: def.ret, run: c => def.run(c, parts.map(p => (p.series ? p.series.run(c) : p.constant))) };
      }
      default: fail('Formül anlaşılamadı');
    }
  }

  /** Compiled formula: { type: 'number' | 'condition', run(bars) -> per-bar values }. Throws FormulaError. */
  function compile(text) {
    const b = build(parse(text));
    return {
      type: b.type === 'b' ? 'condition' : 'number',
      run(bars) {
        const pick = key => bars.map(x => (Number.isFinite(x[key]) ? x[key] : null));
        return b.run({ n: bars.length, open: pick('open'), high: pick('high'), low: pick('low'), close: pick('close'), volume: pick('volume') });
      }
    };
  }

  /** null when the formula is fine (and of the wanted type, if given), else the message. */
  function check(text, type) {
    try {
      const f = compile(text);
      if (type && f.type !== type) return type === 'condition' ? 'Bu bir koşul olmalı (ör. close > sma(close, 50))' : 'Bu bir sayı olmalı (ör. sma(close, 50))';
      return null;
    } catch (e) {
      if (e instanceof FormulaError) return e.message;
      throw e;
    }
  }

  const Formula = { compile, check, FUNCTIONS, FormulaError };
  if (typeof module !== 'undefined' && module.exports) module.exports = Formula;
  else root.Formula = Formula;
})(typeof window !== 'undefined' ? window : globalThis);
