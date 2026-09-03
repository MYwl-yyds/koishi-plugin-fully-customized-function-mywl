// ============ 全自定义功能插件 - 安全表达式求值器 ============
// 不依赖 eval / new Function，支持变量引用、算术、比较、逻辑、三元表达式
// 变量引用方式：{变量名} 或裸标识符（内置变量自动注入）

export type VarMap = Record<string, any>

// 文本模板：将 {var} 替换为变量值；未知变量替换为空串
export function template(text: string, vars: VarMap): string {
  if (!text || text.indexOf('{') < 0) return text ?? ''
  return String(text).replace(/\{([A-Za-z_][\w]*)\}/g, (_, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

// 将变量渲染为表达式可直接解析的文本（字符串加引号、数字保留、布尔/空转字面量）
function renderVar(value: any): string {
  if (value === null || value === undefined) return '""'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const s = String(value)
  // 纯数字字符串不加引号，便于数值比较
  if (/^-?\d+(\.\d+)?$/.test(s.trim())) return s.trim()
  return JSON.stringify(s)
}

// 条件表达式预处理：把 {var} 引用替换为可解析的变量值字面量
function preprocess(expr: string, vars: VarMap): string {
  let out = String(expr)
  out = out.replace(/\{([A-Za-z_][\w]*)\}/g, (_, key: string) => renderVar(vars[key]))
  // 裸标识符：以 var 开头且在变量表中存在才替换；未知标识符当字符串字面量
  out = out.replace(/(?<![A-Za-z0-9_"])([A-Za-z_][\w]*)(?![A-Za-z0-9_])/g, (key: string) => {
    if (key === 'true' || key === 'false' || key === 'null') return key
    if (vars[key] !== undefined) return renderVar(vars[key])
    // 未知标识符（如 {type} == warn 中的 warn）按字符串字面量处理
    return JSON.stringify(key)
  })
  return out
}

type TokenType = 'num' | 'str' | 'op' | 'ident' | 'punc'
interface Token { type: TokenType, value: string }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const ch = input[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    // 数字（含小数/负数前缀交由 unary 处理）
    if (/[0-9]/.test(ch)) {
      let j = i
      while (j < n && /[0-9.]/.test(input[j])) j++
      tokens.push({ type: 'num', value: input.slice(i, j) })
      i = j
      continue
    }
    // 字符串
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      let s = ''
      while (j < n && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < n) {
          s += input[j + 1]
          j += 2
          continue
        }
        s += input[j]
        j++
      }
      tokens.push({ type: 'str', value: s })
      i = j + 1
      continue
    }
    // 标识符
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(input[j])) j++
      tokens.push({ type: 'ident', value: input.slice(i, j) })
      i = j
      continue
    }
    // 多字符运算符
    const two = input.slice(i, i + 2)
    if (['==', '!=', '===', '!==', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'op', value: two })
      i += 2
      continue
    }
    if ('+-*/%<>!?:'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'punc', value: ch })
      i++
      continue
    }
    // 无法识别的字符直接跳过（如中文、逗号）
    i++
  }
  return tokens
}

export class ExprError extends Error {}

function toNumber(v: any): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const s = String(v ?? '').trim()
  const num = Number(s)
  return isNaN(num) ? 0 : num
}

// 带引号判断的字符串比较：若双方任意一方为字符串则整体按字符串比较
function compareLoose(a: any, b: any): any {
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a ?? '') === String(b ?? '')
  }
  return a === b
}

export class ExprParser {
  private tokens: Token[]
  private pos = 0

  constructor(expr: string, private vars: VarMap) {
    this.tokens = tokenize(preprocess(expr, vars))
  }

  private peek(): Token | undefined { return this.tokens[this.pos] }
  private next(): Token | undefined { return this.tokens[this.pos++] }
  private expectOp(v: string): boolean {
    const t = this.peek()
    if (t && t.type === 'op' && t.value === v) { this.pos++; return true }
    return false
  }

  parse(): any {
    const value = this.ternary()
    if (this.peek()) throw new ExprError('表达式存在无法解析的多余内容')
    return value
  }

  private ternary(): any {
    const cond = this.or()
    if (this.expectOp('?')) {
      const t = this.ternary()
      if (!this.expectOp(':')) throw new ExprError('三元表达式缺少 ":"')
      const f = this.ternary()
      return cond ? t : f
    }
    return cond
  }

  private or(): any {
    let left = this.and()
    while (this.expectOp('||')) {
      const right = this.and()
      left = !!left || !!right
    }
    return left
  }

  private and(): any {
    let left = this.equality()
    while (this.expectOp('&&')) {
      const right = this.equality()
      left = !!left && !!right
    }
    return left
  }

  private equality(): any {
    let left = this.relational()
    for (;;) {
      const t = this.peek()
      if (t && t.type === 'op' && (t.value === '==' || t.value === '!=' || t.value === '===' || t.value === '!==')) {
        this.pos++
        const right = this.relational()
        const isNot = t.value.startsWith('!')
        const eq = t.value === '===' || t.value === '!==' ? left === right : compareLoose(left, right)
        left = isNot ? !eq : eq
      } else break
    }
    return left
  }

  private relational(): any {
    let left = this.additive()
    for (;;) {
      const t = this.peek()
      if (t && t.type === 'op' && ['<', '<=', '>', '>='].includes(t.value)) {
        this.pos++
        const right = this.additive()
        const l = toNumber(left)
        const r = toNumber(right)
        if (t.value === '<') left = l < r
        else if (t.value === '<=') left = l <= r
        else if (t.value === '>') left = l > r
        else left = l >= r
      } else break
    }
    return left
  }

  private additive(): any {
    let left = this.multiplicative()
    for (;;) {
      const t = this.peek()
      if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.pos++
        const right = this.multiplicative()
        if (t.value === '+') {
          // 任一为字符串时做字符串拼接
          left = (typeof left === 'string' || typeof right === 'string')
            ? `${left ?? ''}${right ?? ''}`
            : toNumber(left) + toNumber(right)
        } else {
          left = toNumber(left) - toNumber(right)
        }
      } else break
    }
    return left
  }

  private multiplicative(): any {
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      if (t && t.type === 'op' && ['*', '/', '%'].includes(t.value)) {
        this.pos++
        const right = this.unary()
        if (t.value === '*') left = toNumber(left) * toNumber(right)
        else if (t.value === '/') left = toNumber(left) / toNumber(right)
        else left = toNumber(left) % toNumber(right)
      } else break
    }
    return left
  }

  private unary(): any {
    const t = this.peek()
    if (t && t.type === 'op' && t.value === '!') {
      this.pos++
      return !this.unary()
    }
    if (t && t.type === 'op' && t.value === '-') {
      this.pos++
      return -toNumber(this.unary())
    }
    return this.primary()
  }

  private primary(): any {
    const t = this.next()
    if (!t) throw new ExprError('表达式意外结束')
    if (t.type === 'num') {
      const v = parseFloat(t.value)
      return isNaN(v) ? 0 : v
    }
    if (t.type === 'str') return t.value
    if (t.type === 'ident') {
      if (t.value === 'true') return true
      if (t.value === 'false') return false
      if (t.value === 'null') return null
      // 此处的裸标识符已被 preprocess 替换为字面量，兜底按变量取值
      const v = this.vars[t.value]
      return v === undefined ? '' : v
    }
    if (t.type === 'punc' && t.value === '(') {
      const inner = this.ternary()
      const close = this.next()
      if (!close || close.value !== ')') throw new ExprError('缺少右括号 ")"')
      return inner
    }
    throw new ExprError(`无法解析的符号 ${t.value}`)
  }
}

// 求值表达式，返回原始值
export function evaluate(expr: string, vars: VarMap): any {
  const text = String(expr ?? '').trim()
  if (!text) return ''
  return new ExprParser(text, vars).parse()
}

// 求值并转为布尔（条件判断入口）
export function evalCondition(expr: string, vars: VarMap): boolean {
  const v = evaluate(expr, vars)
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = String(v ?? '')
  return s !== '' && s !== '0' && s.toLowerCase() !== 'false'
}