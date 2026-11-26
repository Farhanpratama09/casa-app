/**
 * calcParser.ts — Pure TypeScript Safe Mathematical Expression Evaluator
 *
 * Implements a zero-eval, zero-Function tokenizer + recursive-descent parser
 * complying strictly with `script-src 'self'` CSP and CASA SECURITY_BASELINE.md.
 *
 * Supported syntax:
 *  - Binary operators: `+`, `-`, `*` (`×`), `/` (`÷`), `^` (right-associative)
 *  - Unary sign: `+x`, `-x`
 *  - Grouping: `( ... )` and implicit multiplication `2(3+4)`
 *  - Contextual percentage:
 *      `100000 + 10%` -> `110000`
 *      `100000 - 15%` -> `85000`
 *      `25% * 80`     -> `20`
 *      `50%`          -> `0.5`
 */

export const MAX_CALC_EXPRESSION_LENGTH = 128;
const MAX_CALC_TOKENS = 128;
const MAX_CALC_DEPTH = 32;
const MAX_ABS_EXPONENT = 300;

type TokenKind =
  | 'number'
  | 'plus'
  | 'minus'
  | 'mul'
  | 'div'
  | 'pow'
  | 'percent'
  | 'lparen'
  | 'rparen';

interface Token {
  kind: TokenKind;
  value?: number;
}

export interface CalcEvaluationSuccess {
  ok: true;
  value: number;
  formatted: string;
  copyText: string;
}

export interface CalcEvaluationError {
  ok: false;
  error: string;
}

export type CalcEvaluationResult = CalcEvaluationSuccess | CalcEvaluationError;

function normalizeExpression(raw: string): string {
  return raw
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/,/g, '')
    .trim();
}

function tokenize(expr: string): { ok: true; tokens: Token[] } | CalcEvaluationError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (tokens.length >= MAX_CALC_TOKENS) {
      return { ok: false, error: 'Ekspresi terlalu kompleks.' };
    }

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let start = i;
      let dotCount = 0;
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        if (expr[i] === '.') dotCount++;
        i++;
      }
      if (dotCount > 1) {
        return { ok: false, error: 'Format desimal tidak valid.' };
      }
      const numStr = expr.slice(start, i);
      if (numStr === '.') {
        return { ok: false, error: 'Angka tidak lengkap.' };
      }
      const value = Number(numStr);
      if (!Number.isFinite(value)) {
        return { ok: false, error: 'Angka melebihi batas.' };
      }
      tokens.push({ kind: 'number', value });
      continue;
    }

    switch (ch) {
      case '+':
        tokens.push({ kind: 'plus' });
        i++;
        break;
      case '-':
        tokens.push({ kind: 'minus' });
        i++;
        break;
      case '*':
      case 'x':
      case 'X':
        tokens.push({ kind: 'mul' });
        i++;
        break;
      case '/':
        tokens.push({ kind: 'div' });
        i++;
        break;
      case '^':
        tokens.push({ kind: 'pow' });
        i++;
        break;
      case '%':
        tokens.push({ kind: 'percent' });
        i++;
        break;
      case '(': {
        const prev = tokens[tokens.length - 1];
        if (prev && (prev.kind === 'number' || prev.kind === 'rparen' || prev.kind === 'percent')) {
          tokens.push({ kind: 'mul' });
        }
        tokens.push({ kind: 'lparen' });
        i++;
        break;
      }
      case ')':
        tokens.push({ kind: 'rparen' });
        i++;
        break;
      default:
        return { ok: false, error: `Karakter tidak dikenali: "${ch}"` };
    }
  }

  return { ok: true, tokens };
}

interface TermResult {
  value: number;
  /** True strictly when the entire multiplicative term is a single bare percent operand (e.g. `10%`), enabling `100000 + 10%`. */
  isBarePercent: boolean;
  percentBase?: number;
}

class RecursiveDescentCalc {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  public parse(): number {
    const res = this.parseAdditive(0);
    if (this.pos < this.tokens.length) {
      throw new Error('Sintaks ekspresi tidak valid.');
    }
    return res;
  }

  private parseAdditive(depth: number): number {
    if (depth > MAX_CALC_DEPTH) {
      throw new Error('Kedalaman tanda kurung melebihi batas.');
    }
    let left = this.parseMultiplicative(depth).value;

    while (true) {
      const next = this.peek();
      if (!next || (next.kind !== 'plus' && next.kind !== 'minus')) {
        break;
      }
      const op = this.consume().kind;
      const right = this.parseMultiplicative(depth);
      const rhsVal =
        right.isBarePercent && typeof right.percentBase === 'number'
          ? (left * right.percentBase) / 100
          : right.value;

      left = op === 'plus' ? left + rhsVal : left - rhsVal;
      if (!Number.isFinite(left)) {
        throw new Error('Hasil melebihi batas angka.');
      }
    }

    return left;
  }

  private parseMultiplicative(depth: number): TermResult {
    let first = this.parseUnary(depth);
    let value = first.value;
    let combined = false;

    while (true) {
      const next = this.peek();
      if (!next || (next.kind !== 'mul' && next.kind !== 'div')) {
        break;
      }
      combined = true;
      const op = this.consume().kind;
      const right = this.parseUnary(depth);
      if (op === 'mul') {
        value = value * right.value;
      } else {
        if (right.value === 0) {
          throw new Error('Pembagian dengan nol.');
        }
        value = value / right.value;
      }
      if (!Number.isFinite(value)) {
        throw new Error('Hasil melebihi batas angka.');
      }
    }

    if (combined) {
      return { value, isBarePercent: false };
    }
    return first;
  }

  private parseUnary(depth: number): TermResult {
    if (depth > MAX_CALC_DEPTH) {
      throw new Error('Kedalaman ekspresi melebihi batas.');
    }
    const next = this.peek();
    if (next && (next.kind === 'plus' || next.kind === 'minus')) {
      const op = this.consume().kind;
      const inner = this.parseUnary(depth + 1);
      const signedVal = op === 'minus' ? -inner.value : inner.value;
      return {
        value: signedVal,
        isBarePercent: inner.isBarePercent,
        percentBase:
          typeof inner.percentBase === 'number'
            ? op === 'minus'
              ? -inner.percentBase
              : inner.percentBase
            : undefined,
      };
    }
    return this.parsePower(depth);
  }

  private parsePower(depth: number): TermResult {
    const base = this.parsePostfix(depth);
    const next = this.peek();
    if (next && next.kind === 'pow') {
      this.consume();
      const exp = this.parseUnary(depth + 1);
      if (Math.abs(exp.value) > MAX_ABS_EXPONENT) {
        throw new Error('Eksponen melebihi batas aman.');
      }
      const powered = Math.pow(base.value, exp.value);
      if (!Number.isFinite(powered)) {
        throw new Error('Hasil pangkat terlalu besar (overflow).');
      }
      return { value: powered, isBarePercent: false };
    }
    return base;
  }

  private parsePostfix(depth: number): TermResult {
    const primary = this.parsePrimary(depth);
    let value = primary;
    let percentCount = 0;
    let rawBeforePercent = primary;

    while (this.peek()?.kind === 'percent') {
      this.consume();
      percentCount++;
      value = value / 100;
    }

    return {
      value,
      isBarePercent: percentCount === 1,
      percentBase: percentCount === 1 ? rawBeforePercent : undefined,
    };
  }

  private parsePrimary(depth: number): number {
    const tok = this.peek();
    if (!tok) {
      throw new Error('Ekspresi belum selesai.');
    }
    if (tok.kind === 'number') {
      this.consume();
      return tok.value ?? 0;
    }
    if (tok.kind === 'lparen') {
      this.consume();
      const val = this.parseAdditive(depth + 1);
      if (this.peek()?.kind !== 'rparen') {
        throw new Error('Tanda kurung penutup ")" belum lengkap.');
      }
      this.consume();
      return val;
    }
    throw new Error('Token tidak diharapkan pada ekspresi.');
  }
}

export function normalizeDecimalPrecision(val: number): number {
  if (!Number.isFinite(val)) return val;
  if (Math.abs(val) < 1e-12) return 0;
  return Number(val.toPrecision(12));
}

export function formatCalcNumber(val: number): { formatted: string; copyText: string } {
  const clean = normalizeDecimalPrecision(val);
  if (!Number.isFinite(clean)) {
    return { formatted: 'Error', copyText: '' };
  }
  const copyText = Object.is(clean, -0) ? '0' : String(clean);
  if (Math.abs(clean) >= 1e12 || (Math.abs(clean) > 0 && Math.abs(clean) < 1e-6)) {
    const expStr = clean.toExponential(4).replace(/\.?0+e/, 'e');
    return { formatted: expStr, copyText };
  }
  const formatted = clean.toLocaleString('en-US', {
    maximumFractionDigits: 8,
  });
  return { formatted, copyText };
}

export function evaluateCalcExpression(rawInput: string): CalcEvaluationResult {
  if (rawInput.length > MAX_CALC_EXPRESSION_LENGTH) {
    return {
      ok: false,
      error: `Ekspresi melebihi batas ${MAX_CALC_EXPRESSION_LENGTH} karakter.`,
    };
  }

  const normalized = normalizeExpression(rawInput);
  if (!normalized) {
    return { ok: false, error: 'Masukkan ekspresi matematika.' };
  }

  const tokRes = tokenize(normalized);
  if (!tokRes.ok) {
    return tokRes;
  }
  if (tokRes.tokens.length === 0) {
    return { ok: false, error: 'Masukkan ekspresi matematika.' };
  }

  try {
    const parser = new RecursiveDescentCalc(tokRes.tokens);
    const rawVal = parser.parse();
    const cleanVal = normalizeDecimalPrecision(rawVal);
    if (!Number.isFinite(cleanVal)) {
      return { ok: false, error: 'Hasil tidak terdefinisi.' };
    }
    const { formatted, copyText } = formatCalcNumber(cleanVal);
    return { ok: true, value: cleanVal, formatted, copyText };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Ekspresi tidak valid.',
    };
  }
}
