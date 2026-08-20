<template>
  <div class="lc">
    <div class="lc-head">
      <button type="button" class="lc-nav" @click="shift(-1)"><span class="material-symbols-outlined">chevron_left</span></button>
      <span class="lc-title">{{ monthLabel }}</span>
      <button type="button" class="lc-nav" @click="shift(1)"><span class="material-symbols-outlined">chevron_right</span></button>
      <button type="button" class="lc-today" @click="goToday">Today</button>
    </div>

    <div class="lc-grid">
      <div v-for="d in ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']" :key="d" class="lc-dow">{{ d }}</div>
      <button
        v-for="day in days"
        :key="day.dateStr"
        type="button"
        class="lc-day"
        :class="{
          'other': !day.inMonth,
          'today': day.isToday,
          'weekend': day.weekend,
          'holiday': day.holiday,
          'onleave': day.leave,
          'disabled': day.disabled,
          'sel-start': day.dateStr === start,
          'sel-end': day.dateStr === end,
          'in-range': day.inRange,
        }"
        :disabled="day.disabled"
        :title="day.holiday ? ('Holiday: ' + day.holidayName) : (day.leave ? 'On leave' : '')"
        @click="pick(day)"
      >
        <span class="lc-num">{{ day.num }}</span>
        <span v-if="day.holiday" class="lc-tag">{{ day.holidayName }}</span>
        <span v-else-if="day.leave" class="lc-tag leave">Leave</span>
      </button>
    </div>

    <div class="lc-legend">
      <span class="lc-leg"><span class="sw holiday"></span>Holiday</span>
      <span class="lc-leg"><span class="sw onleave"></span>Your leave</span>
      <span class="lc-leg"><span class="sw sel"></span>Selected</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  holidays: { type: Array, default: () => [] },   // [{date:'YYYY-MM-DD', name}]
  leaves: { type: Array, default: () => [] },      // [{start_date, end_date, status}]
  start: { type: String, default: '' },            // selected range (from parent form)
  end: { type: String, default: '' },
  minDate: { type: String, default: '' },
})
const emit = defineEmits(['select'])

function toStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayStr = toStr(new Date())

const anchor = ref(new Date())
const monthLabel = computed(() => anchor.value.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))
function shift(n) { const d = new Date(anchor.value); d.setMonth(d.getMonth() + n); anchor.value = d }
function goToday() { anchor.value = new Date() }

const holidayMap = computed(() => {
  const m = {}
  for (const h of props.holidays || []) m[h.date] = h.name
  return m
})
function isLeave(dateStr) {
  return (props.leaves || []).some(l => l.status !== 'rejected' && dateStr >= l.start_date && dateStr <= l.end_date)
}

// Second click of a range uses the first as the anchor; a fresh click starts over.
const awaitingEnd = ref(false)

const days = computed(() => {
  const y = anchor.value.getFullYear(), m = anchor.value.getMonth()
  const first = new Date(y, m, 1)
  // Monday-based start
  const startDow = (first.getDay() + 6) % 7
  const gridStart = new Date(y, m, 1 - startDow)
  const out = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i)
    const dateStr = toStr(d)
    const dow = d.getDay()
    const inRange = props.start && props.end && dateStr > props.start && dateStr < props.end
    out.push({
      dateStr,
      num: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: dateStr === todayStr,
      weekend: dow === 0 || dow === 6,
      holiday: dateStr in holidayMap.value,
      holidayName: holidayMap.value[dateStr] || '',
      leave: isLeave(dateStr),
      disabled: props.minDate ? dateStr < props.minDate : false,
      inRange,
    })
  }
  return out
})

function pick(day) {
  if (day.disabled) return
  const date = day.dateStr
  if (!awaitingEnd.value || !props.start) {
    emit('select', { start: date, end: date })
    awaitingEnd.value = true
  } else {
    const a = props.start
    const lo = date < a ? date : a
    const hi = date < a ? a : date
    emit('select', { start: lo, end: hi })
    awaitingEnd.value = false
  }
}
</script>

<style scoped>
.lc { display: flex; flex-direction: column; gap: 10px; }
.lc-head { display: flex; align-items: center; gap: 6px; }
.lc-title { font-weight: 800; font-size: 14px; color: var(--color-on-surface); min-width: 150px; }
.lc-nav {
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--color-outline); border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; color: var(--color-on-surface-variant);
}
.lc-nav:hover { background: var(--color-surface-dim, #f1f5f9); }
.lc-nav .material-symbols-outlined { font-size: 18px; }
.lc-today { margin-left: auto; padding: 5px 12px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); background: var(--color-surface); font-size: 12px; font-weight: 700; color: var(--color-on-surface-variant); cursor: pointer; }
.lc-today:hover { background: var(--color-surface-dim, #f1f5f9); }

.lc-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.lc-dow { text-align: center; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--color-on-surface-variant); padding-bottom: 2px; }
.lc-day {
  position: relative; min-height: 46px; padding: 4px; border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; text-align: left;
  display: flex; flex-direction: column; gap: 1px; transition: background .12s, border-color .12s;
}
.lc-day:hover:not(.disabled) { border-color: var(--color-primary); }
.lc-num { font-size: 12px; font-weight: 700; color: var(--color-on-surface); font-variant-numeric: tabular-nums; }
.lc-day.other { opacity: 0.4; }
.lc-day.weekend { background: #f8fafc; }
.lc-day.today .lc-num { color: var(--color-primary); }
.lc-day.today { border-color: var(--color-primary); }
.lc-day.holiday { background: repeating-linear-gradient(-45deg, #fef3c7, #fef3c7 6px, #fde68a 6px, #fde68a 12px); }
.lc-day.onleave { background: #e5e7eb; }
.lc-day.disabled { opacity: 0.35; cursor: not-allowed; background: #f8fafc; }
.lc-day.in-range { background: var(--color-primary-light, #e6f0f0); border-color: var(--color-primary); }
.lc-day.sel-start, .lc-day.sel-end { background: var(--color-primary); border-color: var(--color-primary); }
.lc-day.sel-start .lc-num, .lc-day.sel-end .lc-num { color: #fff; }
.lc-tag { font-size: 8.5px; font-weight: 700; color: #92400e; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-tag.leave { color: #6b7280; }
.lc-day.sel-start .lc-tag, .lc-day.sel-end .lc-tag { color: #fff; }

.lc-legend { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 2px; }
.lc-leg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--color-on-surface-variant); }
.sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.sw.holiday { background: repeating-linear-gradient(-45deg, #fef3c7, #fef3c7 3px, #fde68a 3px, #fde68a 6px); }
.sw.onleave { background: #e5e7eb; }
.sw.sel { background: var(--color-primary); }
</style>
