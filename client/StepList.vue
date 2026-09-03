<template>
  <div
    class="fc-steplist"
    :class="['zone-' + (zoneRole || 'root'), { 'fc-list-target': isListTarget }]"
    :style="listStyle"
    :data-path="JSON.stringify(listPath)"
  >
    <template v-for="(s, i) in steps" :key="s.id">
      <div v-if="isListTarget && drag.target?.index === i" class="fc-drop-line"></div>
      <div
        class="fc-step"
        :data-id="s.id"
        :class="{
          disabled: !s.enabled,
          selected: selectedIds.has(s.id),
          'fc-drop-target': isParentTarget(s.id),
          'fc-drop-forbidden': isParentTarget(s.id) && !drag.valid,
        }"
        @contextmenu.prevent="onStepCtx($event, s)"
      >
        <div class="fc-step-head" @click="onStepClick($event, s, i)">
          <div class="fc-step-color" :style="{ background: tileColor(s.tile) }"></div>
          <span
            class="fc-drag-handle"
            title="按住拖拽：可调整顺序 / 拖到父磁贴上放为子项"
            @pointerdown.stop="onHandlePointerDown($event, s, i)"
          >⠿</span>
          <div class="fc-step-title">
            <span v-if="pathLabel" class="fc-step-path">{{ pathLabel }} ›</span>
            <span class="fc-step-name">{{ tileName(s.tile) }}</span>
            <span v-if="isInCond" class="fc-rule-summary">{{ ruleSummary(s) }}</span>
          </div>
          <span v-if="hasZone(s.tile)" class="fc-badge-count" :class="{ open: isOpen(s) }">
            {{ isOpen(s) ? '▼' : '▶' }} {{ zoneCount(s) }} 个子项
          </span>
          <div class="fc-step-ops" @click.stop>
            <button class="fc-op" title="启用/禁用" @click="s.enabled = !s.enabled">{{ s.enabled ? '启用' : '禁用' }}</button>
            <button class="fc-op" title="上移" :disabled="i === 0" @click="shift(s, -1)">上移</button>
            <button class="fc-op" title="下移" :disabled="i === steps.length - 1" @click="shift(s, 1)">下移</button>
            <button class="fc-op" title="复制" @click="duplicate(s)">复制</button>
            <button class="fc-op del" title="删除" @click="remove(s)">删除</button>
          </div>
          <button
            class="fc-chevron"
            :class="{ open: isOpen(s) }"
            :title="isOpen(s) ? '折叠子项' : '展开子项'"
            @click.stop="toggleChevron(s)"
          >{{ isOpen(s) ? '▼' : '▶' }}</button>
        </div>

        <transition name="fc-drop-badge">
          <div v-if="isParentTarget(s.id)" class="fc-drop-badge" :class="{ bad: !drag.valid }">
            {{ drag.hint }}
          </div>
        </transition>

        <div v-if="isOpen(s)" class="fc-step-body fc-body-anim">
          <div class="fc-hint" v-if="isInCond">
            📍 本条<b>条件规则</b>：上方磁贴取回数据后，将<b>被比较值</b>按下方运算符与对比值判定；可继续添加多条规则。
          </div>
          <div class="fc-hint" v-if="tileInfo(s.tile)?.description">{{ tileInfo(s.tile)?.description }}</div>

          <div v-if="baseParams(s).length" class="fc-step-params" :class="{ 'fc-form-grid': baseParams(s).length > 1 }">
            <div
              v-for="p in baseParams(s)"
              :key="p.key"
              class="fc-field"
              :class="{ full: p.type === 'textarea' }"
            >
              <label>{{ p.label }}<span v-if="p.required" class="req"> *</span></label>
              <textarea
                v-if="p.type === 'textarea'"
                v-model="s.params[p.key]"
                class="fc-textarea"
                :placeholder="p.placeholder"
              ></textarea>
              <input
                v-else-if="p.type === 'number'"
                v-model.number="s.params[p.key]"
                type="number"
                class="fc-input"
                :min="p.min" :max="p.max"
                :placeholder="p.placeholder"
              />
              <select v-else-if="p.type === 'select'" v-model="s.params[p.key]" class="fc-select">
                <option v-for="o in p.options" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <div v-else-if="p.type === 'boolean'" style="display:flex;align-items:center;gap:8px">
                <div class="fc-switch" :class="{ on: !!s.params[p.key] }" @click="s.params[p.key] = !s.params[p.key]"></div>
                <span class="fc-hint" style="border:none;padding:0;background:transparent">{{ p.hint }}</span>
              </div>
              <input v-else v-model="s.params[p.key]" class="fc-input" :placeholder="p.placeholder" />
              <div v-if="p.hint && p.type !== 'boolean'" class="fc-hint" style="margin-top:5px">{{ p.hint }}</div>
            </div>
          </div>

          <div v-if="tileExamples(s)" class="fc-example-bar">
            <button class="fc-op fc-example-btn" title="一键填入该磁贴的示例参数" @click.stop="applyExample(s)">✨ 填入示例</button>
            <span class="fc-hint" style="margin:0">{{ tileInfo(s.tile)?.exampleNote }}</span>
          </div>

          <!-- 磁贴 JSON 返回字段说明（OneBot 接口 / Koishi 信息类） -->
          <div class="fc-return-fields" v-if="tileReturns(s)?.length">
            <div class="fc-ret-title">📋 本磁贴 JSON 返回可用字段（悬浮查看类型/含义/来源）：</div>
            <div class="fc-ret-grid">
              <span
                v-for="r in tileReturns(s)"
                :key="r.field"
                class="fc-ret-chip"
                :title="`${r.field} · ${r.type}\n${r.meaning}${r.source ? '（' + r.source + '）' : ''}`"
              >
                <code>{{ r.field }}</code>
                <i>{{ r.type }}</i>
              </span>
            </div>
            <div class="fc-hint" style="border:none;padding:0;background:transparent;margin:4px 0 0">
              运行结果以 JSON 文本保存到「结果保存变量」，可用 <code>{变量}</code> 引用；数组元素用下标（如 <code>member_list.0.user_id</code>），对象字段用点路径（如 <code>current_talkative.nickname</code>），在「条件判断」的子磁贴中可通过「取值字段」按路径提取子值比较
            </div>
          </div>

          <!-- 条件规则补充配置 -->
          <div v-if="isInCond" class="fc-rule-fields">
            <div v-if="!isVarSetTile(s)" class="fc-field">
              <label>被比较值（结果变量）</label>
              <input v-model="s.params.resultVar" class="fc-input" :placeholder="condVarPlaceholder(s)" />
              <div class="fc-hint" style="margin-top:5px">填写上一磁贴保存结果的变量名，留空默认取 <code>lastResult</code></div>
            </div>
            <div class="fc-field">
              <label>取值字段（JSON 路径，可选）</label>
              <input v-model="s.params.compareField" class="fc-input" placeholder="如 group_id / user_id" />
              <div class="fc-hint" style="margin-top:5px">返回结果为 JSON 时填字段路径取出子值再比较，留空则比较整个结果</div>
            </div>
            <div class="fc-field">
              <label>比较运算符<span class="req"> *</span></label>
              <select v-model="s.params.compareOp" class="fc-select">
                <option disabled value="">选择运算符…</option>
                <option v-for="o in COMPARE_OPS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div class="fc-field" :class="{ full: !OP_NEEDS_VALUE.has(s.params.compareOp) }">
              <label>对比值<span v-if="OP_NEEDS_VALUE.has(s.params.compareOp)" class="req"> *</span></label>
              <input
                v-model="s.params.compareValue"
                class="fc-input"
                :disabled="!OP_NEEDS_VALUE.has(s.params.compareOp)"
                placeholder="如 123456，支持 {变量}"
              />
              <div v-if="!OP_NEEDS_VALUE.has(s.params.compareOp)" class="fc-hint" style="margin-top:5px">该运算符无需对比值</div>
            </div>
          </div>

          <details class="fc-rule-help" v-if="isInCond">
              <summary>📖 条件规则参数与取值字段（JSON 路径）说明</summary>
              <div class="fc-rule-help-body">
                <p class="fc-rule-help-k">&gt; 条件规则区子磁贴专属参数（仅「条件判断」的子磁贴具备；循环体 / 成立分支 / 否则分支内的子磁贴<b>没有</b>这些参数）：</p>
                <table class="fc-table">
                  <thead><tr><th>参数</th><th>含义</th><th>类型</th><th>必填</th><th>默认值</th><th>示例</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><code>被比较值（resultVar）</code></td>
                      <td>取哪个变量的值作为「被比较值」。它应指向上一磁贴通过「结果保存变量」写入的变量</td>
                      <td>文本</td><td>否</td><td>lastResult</td>
                      <td><code>groupInfo</code></td>
                    </tr>
                    <tr>
                      <td><code>取值字段（compareField）</code></td>
                      <td>从被比较值中按 JSON 路径取出子值再比较。取不到时按空字符串处理（此时「为空」会成立）</td>
                      <td>文本（JSON 点路径）</td><td>否</td><td>空（比较整个结果）</td>
                      <td><code>member_list.0.user_id</code></td>
                    </tr>
                    <tr>
                      <td><code>比较运算符（compareOp）</code></td>
                      <td>被比较值 与 对比值 的判定方式（== != &gt; &gt;= &lt; &lt;= contains / notContains / isEmpty / notEmpty）</td>
                      <td>下拉</td><td>是</td><td>==</td>
                      <td><code>contains</code></td>
                    </tr>
                    <tr>
                      <td><code>对比值（compareValue）</code></td>
                      <td>右侧参与比较的值。支持 <code>{变量}</code> 引用；数字与数字字符串做宽松相等（1 与 '1' 相等），否则按字符串比较</td>
                      <td>文本</td><td>按运算符（除 为空/不为空 外必填）</td><td>空</td>
                      <td><code>12345</code> 或 <code>{userId}</code></td>
                    </tr>
                  </tbody>
                </table>

                <p class="fc-rule-help-k">&gt; 「取值字段」JSON 路径匹配规则：</p>
                <ul>
                  <li>路径用 <code>.</code> 分隔层级；数组元素用下标，如 <code>member_list.0.user_id</code> = 取数组第 0 个元素的 user_id。</li>
                  <li>可用的键名见上方「本接口 JSON 返回可用字段」列表（依据 OneBot v11 文档）；被比较变量本身为普通文本而非 JSON 时，取值字段不生效，按原文本比较。</li>
                  <li>路径不存在 / 值为 null 或 undefined 时：结果按<strong>空字符串</strong>处理，即 <code>isEmpty</code> 成立、<code>== ''</code> 成立，不会报错。</li>
                  <li>返回值统一转字符串后参与比较：取出的数字 123 会以 <code>'123'</code> 与对比值比较（数字可宽松相等）。</li>
                </ul>

                <p class="fc-rule-help-k">&gt; 参数值为 JSON 数据的说明：</p>
                <ul>
                  <li>「对比值」可直接粘贴一段 JSON 文本（如 <code>{"groupId":123}</code>），此时取数结果也会先被序列化为 JSON 文本，二者做<strong>整体文本相等</strong>比较；需要比较 JSON 内部某个键时，请使用「取值字段」取出对应键再比较。</li>
                  <li>「被比较值」变量中的 JSON 对象在执行时自动序列化为字符串保存，其全部键名以「本接口 JSON 返回可用字段」为准；非查询类接口无返回数据，只能比较空串。</li>
                </ul>
              </div>
            </details>
          <template v-if="s.tile === 'sys.if'">
            <div class="fc-zone cond" :style="zoneStyle">
              <div class="fc-zone-title">
                <span>🎯 条件规则区 <em>（添加取值磁贴并配置比较规则，判断满足与否）</em></span>
                <span class="fc-zone-add">
                  <select class="fc-zone-select" title="选择磁贴后立即添加为条件规则" @change="zoneAddEvent($event, s, 'conditionSteps')">
                    <option value="" disabled selected hidden>＋ 添加规则磁贴…</option>
                    <option v-for="t in zoneTileOptions(s, 'conditionSteps')" :key="t.id" :value="t.id">{{ t.label }}</option>
                  </select>
                </span>
              </div>
              <StepList
                :steps="s.conditionSteps || []"
                :list-path="childPath(listPath, i, 'conditionSteps')"
                :tiles="tiles"
                :task-id="taskId"
                zone-role="condition"
                :cond-owner="s"
                :path-label="childLabel(s, '条件规则')"
                :depth="depth + 1"
              />
            </div>
            <div class="fc-zone then" :style="zoneStyle">
              <div class="fc-zone-title">
                <span>✅ 条件成立时执行</span>
                <span class="fc-zone-add">
                  <select class="fc-zone-select" title="选择磁贴后立即添加为步骤" @change="zoneAddEvent($event, s, 'children')">
                    <option value="" disabled selected hidden>＋ 添加步骤…</option>
                    <option v-for="t in zoneTileOptions(s, 'children')" :key="t.id" :value="t.id">{{ t.label }}</option>
                  </select>
                </span>
              </div>
              <StepList
                :steps="s.children || []"
                :list-path="childPath(listPath, i, 'children')"
                :tiles="tiles"
                :task-id="taskId"
                zone-role="branch"
                :path-label="childLabel(s, '成立分支')"
                :depth="depth + 1"
              />
            </div>
            <div class="fc-zone else" :style="zoneStyle">
              <div class="fc-zone-title">
                <span>❌ 条件不成立时执行</span>
                <span class="fc-zone-add">
                  <select class="fc-zone-select" title="选择磁贴后立即添加为步骤" @change="zoneAddEvent($event, s, 'elseChildren')">
                    <option value="" disabled selected hidden>＋ 添加步骤…</option>
                    <option v-for="t in zoneTileOptions(s, 'elseChildren')" :key="t.id" :value="t.id">{{ t.label }}</option>
                  </select>
                </span>
              </div>
              <StepList
                :steps="s.elseChildren || []"
                :list-path="childPath(listPath, i, 'elseChildren')"
                :tiles="tiles"
                :task-id="taskId"
                zone-role="branch"
                :path-label="childLabel(s, '否则分支')"
                :depth="depth + 1"
              />
            </div>
          </template>
          <div v-else-if="s.tile === 'sys.loop_count' || s.tile === 'sys.loop_while'" class="fc-zone loop" :style="zoneStyle">
            <div class="fc-zone-title">
              <span>🔁 循环体（每次循环执行）</span>
              <span class="fc-zone-add">
                <select class="fc-zone-select" title="选择磁贴后立即添加为步骤" @change="zoneAddEvent($event, s, 'children')">
                  <option value="" disabled selected hidden>＋ 添加步骤…</option>
                  <option v-for="t in zoneTileOptions(s, 'children')" :key="t.id" :value="t.id">{{ t.label }}</option>
                </select>
              </span>
            </div>
            <StepList
              :steps="s.children || []"
              :list-path="childPath(listPath, i, 'children')"
              :tiles="tiles"
              :task-id="taskId"
              zone-role="branch"
              :path-label="childLabel(s, '循环体')"
              :depth="depth + 1"
            />
          </div>
        </div>
      </div>
    </template>
    <div v-if="isListTarget && drag.target?.index === (steps || []).length" class="fc-drop-line"></div>
    <div v-if="(steps || []).length === 0 && !isListTarget" class="fc-empty">
      <template v-if="zoneRole === 'condition'">拖拽/点击取值磁贴添加条件规则；每条规则 = 取数 + 比较运算</template>
      <template v-else>拖拽磁贴到此处，或点击左侧磁贴添加到任务</template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Step, TileDef, newStep, moveByOffset, findPath, removeByPath, insertByPath,
  deepCloneSteps, COMPARE_OPS, OP_NEEDS_VALUE,
  stepSelection, openCtxMenu, ensureCollapse, persistCollapse, removeMany,
  drag, startDragDetail, setDragPos, cancelDrag, computePointerTarget, refreshDragValidity,
  dropIntoList, dropOntoParent, listKeyOf, rootSteps, getListAtPath,
} from './steps'
import { toast } from './toast'

const props = defineProps<{
  steps: Step[]
  listPath: (number | string)[]
  tiles: TileDef[]
  taskId?: string
  zoneRole?: 'condition' | 'branch' | 'loop' | null
  condOwner?: Step | null
  pathLabel?: string
  depth?: number
}>()

const taskKey = computed(() => String(props.taskId || 'draft'))
const collapseMap = computed(() => ensureCollapse(taskKey.value))

// ---------- 层级视觉 ----------
const DEPTH_COLORS = ['#4f7cff', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f43f5e']
const depth = computed(() => props.depth || 0)
function depthColor(d: number): string {
  return DEPTH_COLORS[d % DEPTH_COLORS.length]
}
const listStyle = computed(() => {
  const d = depth.value
  return {
    '--fc-depth-color': depthColor(d),
    marginLeft: d > 0 ? `${Math.max(16, Math.min(d, 6) * 12)}px` : '0px',
  } as Record<string, any>
})
const zoneStyle = computed(() => {
  const d = depth.value
  return {
    '--fc-depth-color': depthColor(d + 1),
    marginLeft: `${Math.max(16, 4 + Math.min(d + 1, 6) * 12)}px`,
  } as Record<string, any>
})

// ---------- 展开/折叠 ----------
function isOpen(s: Step): boolean {
  return !collapseMap.value[s.id]
}
function toggleChevron(s: Step) {
  collapseMap.value[s.id] = !collapseMap.value[s.id]
  persistCollapse(props.taskId)
}

const isInCond = computed(() => props.zoneRole === 'condition')

function tileInfo(id: string): TileDef | undefined {
  return props.tiles.find((t) => t.id === id)
}
function tileReturns(s: Step): TileDef['returns'] {
  return tileInfo(s.tile)?.returns
}
function tileExamples(s: Step): Record<string, any> | undefined {
  return tileInfo(s.tile)?.examples
}
function applyExample(s: Step) {
  const ex = tileExamples(s)
  if (!ex) return
  Object.assign(s.params, JSON.parse(JSON.stringify(ex)))
  toast.success(`已填入「${tileName(s.tile)}」示例参数，可立即运行体验`)
}
function tileName(id: string): string {
  return tileInfo(id)?.label || id
}
function tileColor(id: string): string {
  return tileInfo(id)?.color || '#888'
}

const condTiles = computed(() => props.tiles.filter((t) => t.kind === 'onebot' || t.id === 'sys.var_set'))
const allTiles = computed(() => props.tiles)

function hasZone(id: string): boolean {
  return id === 'sys.if' || id === 'sys.loop_count' || id === 'sys.loop_while'
}
function zoneCount(s: Step): number {
  if (s.tile === 'sys.if') {
    return (s.children?.length || 0) + (s.elseChildren?.length || 0) + (s.conditionSteps?.length || 0)
  }
  return s.children?.length || 0
}

function isVarSetTile(s: Step): boolean {
  return s.tile === 'sys.var_set'
}
function baseParams(s: Step): TileDef['params'] {
  return tileInfo(s.tile)?.params || []
}

// ---------- 条件规则摘要 ----------
function condVarOf(s: Step): string {
  if (isVarSetTile(s)) return String(s.params?.var || '').trim()
  return String(s.params?.resultVar || '').trim()
}
function condVarPlaceholder(s: Step): string {
  if (isVarSetTile(s)) return String(s.params?.var || '') || '变量名'
  return 'lastResult'
}
function ruleSummary(s: Step): string {
  const v = condVarOf(s) || (isVarSetTile(s) ? '变量' : 'lastResult')
  const field = String(s.params?.compareField || '').trim()
  const src = `${v}${field ? '.' + field : ''}`
  const op = String(s.params?.compareOp || '==')
  if (op === 'isEmpty') return `if ${src} 为空`
  if (op === 'notEmpty') return `if ${src} 不为空`
  const label = COMPARE_OPS.find((o) => o.value === op)?.label.split(' ')[0] || op
  return `${src} ${label} ${String(s.params?.compareValue ?? '').trim() || '∅'}`
}

watch(() => props.steps, (list) => {
  if (props.zoneRole !== 'condition') return
  for (const s of list) {
    if (!s.params) continue
    if (!s.params.compareOp) s.params.compareOp = '=='
  }
}, { immediate: true })

function nextCondName(owner: Step): string {
  let max = 0
  for (const c of owner.conditionSteps || []) {
    const m = /^cond(\d+)$/.exec(String(c.params?.resultVar || '').trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `cond${max + 1}`
}
function finalizeCondStep(step: Step) {
  if (!props.condOwner) return
  if (!step.params.compareOp) step.params.compareOp = '=='
  const tile = tileInfo(step.tile)
  const hasResultVar = tile?.params.some((p) => p.key === 'resultVar')
  if (hasResultVar) {
    const cur = String(step.params?.resultVar || '').trim()
    if (!cur || cur === 'lastResult') step.params.resultVar = nextCondName(props.condOwner)
  }
}

function eligibleForCond(tileId: string): boolean {
  return condTiles.value.some((t) => t.id === tileId)
}
function zoneTileOptions(s: Step, field: 'children' | 'elseChildren' | 'conditionSteps'): TileDef[] {
  return field === 'conditionSteps' ? condTiles.value : allTiles.value
}
function zoneAddEvent(ev: Event, s: Step, field: 'children' | 'elseChildren' | 'conditionSteps') {
  const sel = ev.target as HTMLSelectElement
  const tileId = sel.value
  sel.value = ''
  if (!tileId) return
  addStepInto(s, field, tileId)
}
function addStepInto(s: Step, field: 'children' | 'elseChildren' | 'conditionSteps', tileId: string) {
  if (field === 'conditionSteps' && !eligibleForCond(tileId)) {
    toast.warning('该磁贴不能添加为条件规则（仅 OneBot 接口 / 设置变量 可作为取值）')
    return
  }
  if (!s[field]) s[field] = []
  const step = newStep(tileId, props.tiles)
  if (field === 'conditionSteps') {
    step.params.compareOp = '=='
    if (tileId !== 'sys.var_set') step.params.resultVar = nextCondName(s)
  }
  ;(s[field] as Step[]).push(step)
  delete collapseMap.value[s.id]
  persistCollapse(props.taskId)
}

function childPath(parent: (number | string)[], index: number, field: string): (number | string)[] {
  return [...parent, index, field]
}
function childLabel(s: Step, zoneShort: string): string {
  const base = props.pathLabel ? `${props.pathLabel} › ${tileName(s.tile)}` : tileName(s.tile)
  return `${base} › ${zoneShort}`
}

// ---------- 多选（Shift / Ctrl / 单击） ----------
const selectedIds = computed(() => stepSelection.ids)
const anchor = ref(-1)
function selectCore(s: Step, i: number, ctrl: boolean, shift: boolean) {
  if (ctrl) {
    if (stepSelection.ids.has(s.id)) stepSelection.ids.delete(s.id)
    else stepSelection.ids.add(s.id)
    anchor.value = -1
    return
  }
  if (shift) {
    const from = anchor.value >= 0 ? anchor.value : 0
    stepSelection.ids.clear()
    const [a, b] = from <= i ? [from, i] : [i, from]
    for (let k = a; k <= b; k++) stepSelection.ids.add(props.steps[k].id)
    return
  }
  stepSelection.ids.clear()
  stepSelection.ids.add(s.id)
  anchor.value = i
}
function onStepClick(e: MouseEvent, s: Step, i: number) {
  selectCore(s, i, e.ctrlKey || e.metaKey, e.shiftKey)
}
function onStepCtx(e: MouseEvent, s: Step) {
  if (!stepSelection.ids.has(s.id)) {
    stepSelection.ids.clear()
    stepSelection.ids.add(s.id)
  }
  openCtxMenu(e, s.id)
}

// ---------- 指针拖拽（鼠标 / 触屏长按 300ms） ----------
const pressTimer = ref<any>(null)
function onHandlePointerDown(e: PointerEvent, s: Step, i: number) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  let armed = false
  let dragging = false
  const handle = e.currentTarget as HTMLElement
  // 按下即预选
  if (!stepSelection.ids.has(s.id)) {
    stepSelection.ids.clear()
    stepSelection.ids.add(s.id)
  }
  const hasZoneFn = (id: string) => hasZone(id)

  function cleanup() {
    clearTimeout(pressTimer.value)
    if (targetRaf) { cancelAnimationFrame(targetRaf); targetRaf = 0 }
    lastTargetKey = ''
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }
  function beginDrag() {
    dragging = true
    const rect = handle.getBoundingClientRect()
    const ids = stepSelection.ids.size >= 2 && stepSelection.ids.has(s.id)
      ? [...stepSelection.ids]
      : [s.id]
    startDragDetail('step', ids, '', startX - rect.left, startY - rect.top)
    setDragPos(startX, startY)
  }
  // 拖拽目标计算：rAF 合帧，且目标不变/未超 100ms 时跳过，避免每帧刷新全树 class
  let targetRaf = 0
  let lastTargetKey = ''
  let lastTargetTime = 0
  function updatePointerTarget(x: number, y: number) {
    const now = Date.now()
    let next = computePointerTarget(x, y)
    if (next?.node === 'parent' && drag.ids.includes(next.parentId)) next = null // 自身不可作父
    const key = next ? (next.node === 'parent' ? 'p:' + next.parentId : 'l:' + listKeyOf(next.listPath) + ':' + next.index) : ''
    if (key === lastTargetKey && now - lastTargetTime < 100) return
    lastTargetKey = key
    lastTargetTime = now
    drag.target = next
    refreshDragValidity(hasZoneFn)
  }
  const onMove = (ev: PointerEvent) => {
    const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY)
    if (!dragging && (armed || dist > 6)) beginDrag()
    if (!dragging) return
    setDragPos(ev.clientX, ev.clientY)
    if (targetRaf) return
    const px = ev.clientX
    const py = ev.clientY
    targetRaf = requestAnimationFrame(() => {
      targetRaf = 0
      updatePointerTarget(px, py)
    })
  }
  const onUp = (ev: PointerEvent) => {
    cleanup()
    if (!dragging) {
      // 单击：选择（保留 ctrl/shift）
      selectCore(s, i, ev.ctrlKey || ev.metaKey, ev.shiftKey)
      return
    }
    // 释放：执行放置
    if (drag.target && drag.valid) {
      if (drag.target.node === 'parent') {
        dropOntoParent(drag.ids, drag.target.parentId, hasZoneFn)
      } else {
        dropIntoList(drag.ids, drag.target.listPath, drag.target.index)
      }
      postProcessMoved(drag.ids)
    }
    cancelDrag()
  }
  const onCancel = () => {
    cleanup()
    cancelDrag()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  pressTimer.value = setTimeout(() => { armed = true }, 300)
}

// 拖拽落位后处理条件规则语义（进/出条件区时自动命名与清理）
function postProcessMoved(ids: string[]) {
  for (const id of ids) {
    const p = findPath(rootSteps.value, id)
    if (!p) continue
    const movedStep = getListAtPath(rootSteps.value, p.slice(0, -1))?.[p[p.length - 1] as number]
    if (!movedStep) continue
    const ci = p.lastIndexOf('conditionSteps')
    const inCond = ci >= 0
    const tile = tileInfo(movedStep.tile)
    if (inCond) {
      // 找到所属 if（owner 路径 = p 去掉最后两段）
      const ownerPath = p.slice(0, -2)
      const owner = getListAtPath(rootSteps.value, ownerPath.slice(0, -1))?.[ownerPath[ownerPath.length - 1] as number] as Step | undefined
      if (owner) {
        if (!movedStep.params.compareOp) movedStep.params.compareOp = '=='
        const hasResultVar = tile?.params.some((pp) => pp.key === 'resultVar')
        if (hasResultVar) {
          const cur = String(movedStep.params?.resultVar || '').trim()
          if (!cur || cur === 'lastResult') movedStep.params.resultVar = nextCondName(owner)
        }
      }
    } else if (tile?.params.some((pp) => pp.key === 'resultVar')) {
      if (/^cond\d+$/.test(String(movedStep.params?.resultVar || '').trim())) {
        movedStep.params.resultVar = ''
      }
    }
  }
}

// 拖拽目标判定（本列表 / 本卡）
const dragTarget = computed(() => (drag.active ? drag.target : null))
const isListTarget = computed(() =>
  dragTarget.value?.node === 'list' && listKeyOf(props.listPath) === listKeyOf(dragTarget.value.listPath),
)
function isParentTarget(id: string): boolean {
  return dragTarget.value?.node === 'parent' && dragTarget.value.parentId === id
}

// ---------- 增删改 ----------
function shift(s: Step, delta: -1 | 1) {
  moveByOffset(s.id, delta)
}
function duplicate(s: Step) {
  const [copy] = deepCloneSteps([s])
  const path = findPath(props.steps, s.id)
  if (path) {
    const last = path[path.length - 1]
    const insertPath = [...listPathOf(path), (typeof last === 'number' ? last : 0) + 1]
    insertByPath(insertPath, copy)
  }
}
function remove(s: Step) {
  if (stepSelection.ids.size > 1 && stepSelection.ids.has(s.id)) {
    removeMany([...stepSelection.ids])
    stepSelection.ids.clear()
    return
  }
  const path = findPath(props.steps, s.id)
  if (path) removeByPath([...listPathOf(path), path[path.length - 1]])
  stepSelection.ids.delete(s.id)
}
function listPathOf(rel: (number | string)[]): (number | string)[] {
  return [...props.listPath, ...rel.slice(0, -1)]
}
</script>