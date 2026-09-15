'use strict';

/* =========================================================
   バルセロナ家計簿 「暮らしの支出」
   localStorage キー: bcn-ledger-v1
   ========================================================= */

const STORAGE_KEY = 'bcn-ledger-v1';

const DEFAULT_CATEGORIES = [
  { id: 'food',      name: '食費',   icon: '🍴' },
  { id: 'daily',     name: '日用品', icon: '🧴' },
  { id: 'rent',      name: '家賃',   icon: '🏠' },
  { id: 'transport', name: '交通費', icon: '🚇' },
  { id: 'tobacco',   name: 'タバコ', icon: '🚬' }
];

const DEFAULT_MEMO_PRESETS = ['Mercadona', 'Condis', 'TMB', 'ETSEIB'];

const CHART_COLORS = ['#1677ff', '#ff8a3d', '#2fbf71', '#ffb020', '#7c5cff', '#ff5c8a', '#20b8c4', '#c4832f', '#5c8aff', '#9a5cff'];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultState() {
  const today = todayStr();
  const inThreeMonths = new Date();
  inThreeMonths.setMonth(inThreeMonths.getMonth() + 4);
  const endDefault = inThreeMonths.toISOString().slice(0, 10);
  return {
    expenses: [],
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    deletedCategories: [],
    chartExcluded: [],
    memoPresets: DEFAULT_MEMO_PRESETS.slice(),
    settings: {
      rateMode: 'fixed',
      fixedRate: 165,
      liveRate: null,
      liveRateDate: null,
      tripStart: today,
      tripEnd: endDefault
    },
    period: 'today'
  };
}

/* ---------- 状態の読み込み・保存 ---------- */

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // 最低限の構造検証・補完
    const base = defaultState();
    const merged = {
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : base.expenses,
      categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : base.categories,
      deletedCategories: Array.isArray(parsed.deletedCategories) ? parsed.deletedCategories : base.deletedCategories,
      chartExcluded: Array.isArray(parsed.chartExcluded) ? parsed.chartExcluded : base.chartExcluded,
      memoPresets: Array.isArray(parsed.memoPresets) ? parsed.memoPresets : base.memoPresets,
      settings: { ...base.settings, ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}) },
      period: ['today', 'month', 'all'].includes(parsed.period) ? parsed.period : 'today'
    };
    return merged;
  } catch (e) {
    console.error('保存データの読み込みに失敗したため初期状態で起動します', e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('保存に失敗しました', e);
    showToast('データの保存に失敗しました', true);
  }
}

/* ---------- ユーティリティ ---------- */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function genId() {
  return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function formatEur(amount) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatJpy(amount) {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(Math.round(amount));
}

function currentRate() {
  const s = state.settings;
  if (s.rateMode === 'live' && typeof s.liveRate === 'number' && s.liveRate > 0) {
    return s.liveRate;
  }
  return s.fixedRate > 0 ? s.fixedRate : 165;
}

function toJpy(eur) {
  return eur * currentRate();
}

function getCategoryById(id) {
  return state.categories.find(c => c.id === id) ||
    state.deletedCategories.find(c => c.id === id) || null;
}

function isCategoryDeleted(id) {
  return state.deletedCategories.some(c => c.id === id);
}

function categoryDisplayName(exp) {
  // 履歴表示用: 現在のカテゴリ名を反映。削除済みなら「名前（削除済み）」
  const cat = state.categories.find(c => c.id === exp.categoryId);
  if (cat) return cat.name;
  const del = state.deletedCategories.find(c => c.id === exp.categoryId);
  if (del) return `${del.name}（削除済み）`;
  // カテゴリ情報自体が見つからない場合は登録時の名前を使う
  return `${exp.categoryNameSnapshot || '不明'}（削除済み）`;
}

function categoryIconOrLabel(catId) {
  const cat = state.categories.find(c => c.id === catId) || state.deletedCategories.find(c => c.id === catId);
  if (!cat) return '？';
  if (cat.icon) return cat.icon;
  const ch = (cat.name || '').trim().charAt(0);
  return ch || '？';
}

/* ---------- 期間フィルタ ---------- */

function getPeriodRange(period) {
  const today = todayStr();
  if (period === 'today') {
    return { start: today, end: today };
  }
  if (period === 'month') {
    const [y, m] = today.split('-');
    const start = `${y}-${m}-01`;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    const end = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }
  // all
  return { start: state.settings.tripStart, end: state.settings.tripEnd };
}

function filterExpensesByPeriod(period) {
  const { start, end } = getPeriodRange(period);
  return state.expenses.filter(e => e.date >= start && e.date <= end);
}

/* ---------- 描画: ヘッダー / 合計 / カテゴリ別小計 ---------- */

function render() {
  renderPeriodButtons();
  renderTotals();
  renderCategorySummary();
  renderChart();
  renderHistory();
}

function renderPeriodButtons() {
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === state.period);
  });
}

function renderTotals() {
  const list = filterExpensesByPeriod(state.period);
  const totalEur = list.reduce((sum, e) => sum + e.amountEur, 0);
  document.getElementById('totalEur').textContent = formatEur(totalEur);
  document.getElementById('totalJpy').textContent = formatJpy(toJpy(totalEur));

  const rate = currentRate();
  document.getElementById('rateLabel').textContent = `€1 = ¥${rate.toFixed(2)}`;
  document.getElementById('rateMode').textContent = state.settings.rateMode === 'live' ? '最新' : '固定';
}

function renderCategorySummary() {
  const list = filterExpensesByPeriod(state.period);
  const byCategory = new Map();
  list.forEach(e => {
    byCategory.set(e.categoryId, (byCategory.get(e.categoryId) || 0) + e.amountEur);
  });

  const container = document.getElementById('categorySummary');
  container.innerHTML = '';

  if (byCategory.size === 0) {
    const chip = document.createElement('div');
    chip.className = 'category-chip';
    chip.textContent = '支出がありません';
    container.appendChild(chip);
    return;
  }

  // カテゴリ定義順 + 削除済みの順で表示
  const orderedIds = [...state.categories.map(c => c.id), ...state.deletedCategories.map(c => c.id)];
  orderedIds.forEach(id => {
    if (!byCategory.has(id)) return;
    const amount = byCategory.get(id);
    const chip = document.createElement('div');
    chip.className = 'category-chip';
    const nameHtml = escapeHtml(categoryDisplayName({ categoryId: id, categoryNameSnapshot: '' }));
    chip.innerHTML = `<b>${nameHtml}</b><span class="tabular">${escapeHtml(formatEur(amount))}</span>`;
    container.appendChild(chip);
  });
}

/* ---------- 円グラフ ---------- */

function renderChart() {
  const list = filterExpensesByPeriod(state.period);
  const byCategory = new Map();
  list.forEach(e => {
    if (state.chartExcluded.includes(e.categoryId)) return;
    byCategory.set(e.categoryId, (byCategory.get(e.categoryId) || 0) + e.amountEur);
  });

  const svg = document.getElementById('donutChart');
  const legend = document.getElementById('chartLegend');
  const emptyMsg = document.getElementById('chartEmpty');
  const donutTotal = document.getElementById('donutTotal');

  svg.innerHTML = '';
  legend.innerHTML = '';

  const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
  donutTotal.textContent = formatEur(total);

  if (total <= 0 || byCategory.size === 0) {
    emptyMsg.hidden = false;
    svg.style.display = 'none';
    return;
  }
  emptyMsg.hidden = true;
  svg.style.display = '';

  const orderedIds = [...state.categories.map(c => c.id), ...state.deletedCategories.map(c => c.id)]
    .filter(id => byCategory.has(id));

  const cx = 100, cy = 100, rOuter = 90, rInner = 55;
  let cumulative = 0;

  orderedIds.forEach((id, idx) => {
    const amount = byCategory.get(id);
    const fraction = amount / total;
    const color = CHART_COLORS[idx % CHART_COLORS.length];

    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    cumulative += fraction;
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;

    const path = describeDonutSegment(cx, cy, rInner, rOuter, startAngle, endAngle, fraction >= 0.999);
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', path);
    pathEl.setAttribute('fill', color);
    svg.appendChild(pathEl);

    const pct = Math.round(fraction * 100);
    const name = categoryDisplayName({ categoryId: id, categoryNameSnapshot: '' });
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-dot" style="background:${color}"></span>` +
      `<span class="legend-name">${escapeHtml(name)}</span>` +
      `<span class="legend-pct tabular">${pct}%</span>`;
    legend.appendChild(row);
  });
}

function describeDonutSegment(cx, cy, rInner, rOuter, startAngle, endAngle, isFull) {
  if (isFull) {
    // ほぼ100%の場合、リング全体を2つの半円で描画（0/360度の特異点回避）
    return [
      arcRingFull(cx, cy, rInner, rOuter)
    ].join(' ');
  }
  const p1 = polar(cx, cy, rOuter, startAngle);
  const p2 = polar(cx, cy, rOuter, endAngle);
  const p3 = polar(cx, cy, rInner, endAngle);
  const p4 = polar(cx, cy, rInner, startAngle);
  const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    'Z'
  ].join(' ');
}

function arcRingFull(cx, cy, rInner, rOuter) {
  const a1 = polar(cx, cy, rOuter, 0);
  const a2 = polar(cx, cy, rOuter, Math.PI);
  const b1 = polar(cx, cy, rInner, Math.PI);
  const b2 = polar(cx, cy, rInner, 0);
  return [
    `M ${a1.x} ${a1.y}`,
    `A ${rOuter} ${rOuter} 0 1 1 ${a2.x} ${a2.y}`,
    `A ${rOuter} ${rOuter} 0 1 1 ${a1.x} ${a1.y}`,
    `M ${b1.x} ${b1.y}`,
    `A ${rInner} ${rInner} 0 1 0 ${b2.x} ${b2.y}`,
    `A ${rInner} ${rInner} 0 1 0 ${b1.x} ${b1.y}`,
    'Z'
  ].join(' ');
}

function polar(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/* ---------- 履歴 ---------- */

function renderHistory() {
  const list = filterExpensesByPeriod(state.period);
  const sorted = list.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt;
  });

  const ul = document.getElementById('historyList');
  const emptyMsg = document.getElementById('historyEmpty');
  const countEl = document.getElementById('historyCount');

  ul.innerHTML = '';
  countEl.textContent = sorted.length > 0 ? `${sorted.length}件` : '';

  if (sorted.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  sorted.forEach(exp => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.dataset.id = exp.id;

    const catName = categoryDisplayName(exp);
    const icon = categoryIconOrLabel(exp.categoryId) === '？' && exp.categoryNameSnapshot
      ? exp.categoryNameSnapshot.charAt(0)
      : categoryIconOrLabel(exp.categoryId);
    const memoText = exp.memo && exp.memo.trim() ? exp.memo : catName;

    li.innerHTML = `
      <div class="history-icon">${escapeHtml(icon)}</div>
      <div class="history-main">
        <div class="history-memo">${escapeHtml(memoText)}</div>
        <div class="history-sub">${escapeHtml(exp.date)} ・ ${escapeHtml(catName)}</div>
      </div>
      <div class="history-amounts">
        <div class="history-eur tabular">${escapeHtml(formatEur(exp.amountEur))}</div>
        <div class="history-jpy tabular">${escapeHtml(formatJpy(toJpy(exp.amountEur)))}</div>
      </div>
    `;
    li.addEventListener('click', () => openExpenseModal(exp.id));
    ul.appendChild(li);
  });
}

/* ---------- 支出 追加/編集 モーダル ---------- */

const expenseModal = document.getElementById('expenseModal');
const expenseForm = document.getElementById('expenseForm');

function populateCategorySelect() {
  const select = document.getElementById('expenseCategory');
  select.innerHTML = '';
  state.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  });
}

function renderMemoShortcuts() {
  const container = document.getElementById('memoShortcuts');
  container.innerHTML = '';
  state.memoPresets.forEach(preset => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'memo-chip';
    btn.textContent = preset;
    btn.addEventListener('click', () => {
      const input = document.getElementById('expenseMemo');
      input.value = `${preset} `;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    container.appendChild(btn);
  });
}

function openExpenseModal(expenseId) {
  populateCategorySelect();
  renderMemoShortcuts();

  const title = document.getElementById('expenseModalTitle');
  const deleteBtn = document.getElementById('btnDeleteExpense');
  const idField = document.getElementById('expenseId');
  const amountField = document.getElementById('expenseAmount');
  const categoryField = document.getElementById('expenseCategory');
  const dateField = document.getElementById('expenseDate');
  const memoField = document.getElementById('expenseMemo');

  if (expenseId) {
    const exp = state.expenses.find(e => e.id === expenseId);
    if (!exp) return;
    title.textContent = '支出を編集';
    deleteBtn.hidden = false;
    idField.value = exp.id;
    amountField.value = exp.amountEur.toFixed(2);
    if (!isCategoryDeleted(exp.categoryId) && state.categories.some(c => c.id === exp.categoryId)) {
      categoryField.value = exp.categoryId;
    } else {
      // 削除済みカテゴリは選択肢にないため先頭を仮選択（保存時は変更されない限り維持したいが、
      // 削除済みは新規選択不可のため、編集せず削除のみ許可する運用にする）
      const optDeleted = document.createElement('option');
      optDeleted.value = exp.categoryId;
      optDeleted.textContent = `${categoryDisplayName(exp)}（選択不可）`;
      optDeleted.disabled = true;
      categoryField.insertBefore(optDeleted, categoryField.firstChild);
      categoryField.value = exp.categoryId;
    }
    dateField.value = exp.date;
    memoField.value = exp.memo || '';
  } else {
    title.textContent = '支出を追加';
    deleteBtn.hidden = true;
    idField.value = '';
    amountField.value = '';
    dateField.value = todayStr();
    memoField.value = '';
    if (state.categories.length > 0) categoryField.value = state.categories[0].id;
  }

  expenseModal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => amountField.focus(), 50);
}

function closeExpenseModal() {
  expenseModal.hidden = true;
  document.body.style.overflow = '';
}

document.getElementById('btnAdd').addEventListener('click', () => openExpenseModal(null));
document.getElementById('btnCloseExpense').addEventListener('click', closeExpenseModal);
expenseModal.addEventListener('click', (e) => { if (e.target === expenseModal) closeExpenseModal(); });

expenseForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const idField = document.getElementById('expenseId');
  const amountField = document.getElementById('expenseAmount');
  const categoryField = document.getElementById('expenseCategory');
  const dateField = document.getElementById('expenseDate');
  const memoField = document.getElementById('expenseMemo');

  const amountRaw = amountField.value.trim().replace(',', '.');
  const amount = parseFloat(amountRaw);
  if (!amountRaw || isNaN(amount) || amount <= 0) {
    showToast('金額は0より大きい数値で入力してください', true);
    return;
  }
  const amountRounded = Math.round(amount * 100) / 100;

  const categoryId = categoryField.value;
  if (!categoryId) {
    showToast('カテゴリを選択してください', true);
    return;
  }

  const date = dateField.value;
  if (!date) {
    showToast('日付を入力してください', true);
    return;
  }

  const memo = memoField.value.slice(0, 60);
  const cat = getCategoryById(categoryId);

  if (idField.value) {
    const exp = state.expenses.find(x => x.id === idField.value);
    if (exp) {
      exp.amountEur = amountRounded;
      exp.categoryId = categoryId;
      exp.categoryNameSnapshot = cat ? cat.name : exp.categoryNameSnapshot;
      exp.date = date;
      exp.memo = memo;
    }
    showToast('支出を更新しました');
  } else {
    state.expenses.push({
      id: genId(),
      date,
      amountEur: amountRounded,
      categoryId,
      categoryNameSnapshot: cat ? cat.name : '',
      memo,
      createdAt: Date.now()
    });
    showToast('支出を追加しました');
  }

  saveState();
  render();
  closeExpenseModal();
});

document.getElementById('btnDeleteExpense').addEventListener('click', () => {
  const id = document.getElementById('expenseId').value;
  if (!id) return;
  showConfirm('支出を削除しますか？', 'この操作は取り消せません。', () => {
    state.expenses = state.expenses.filter(e => e.id !== id);
    saveState();
    render();
    closeExpenseModal();
    showToast('支出を削除しました');
  });
});

/* ---------- 期間切り替え ---------- */

document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.period = btn.dataset.period;
    saveState();
    render();
  });
});

/* ---------- 円グラフ 表示カテゴリ選択 ---------- */

const chartFilterModal = document.getElementById('chartFilterModal');

function openChartFilterModal() {
  const list = document.getElementById('chartFilterList');
  list.innerHTML = '';
  const allCats = [...state.categories, ...state.deletedCategories];
  allCats.forEach(cat => {
    const li = document.createElement('li');
    li.className = 'manage-row';
    const checked = !state.chartExcluded.includes(cat.id);
    li.innerHTML = `
      <input type="checkbox" data-cat="${escapeHtml(cat.id)}" ${checked ? 'checked' : ''}>
      <span class="manage-name">${escapeHtml(cat.name)}${isCategoryDeleted(cat.id) ? '（削除済み）' : ''}</span>
    `;
    list.appendChild(li);
  });
  chartFilterModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeChartFilterModal() {
  chartFilterModal.hidden = true;
  document.body.style.overflow = '';
}

document.getElementById('btnChartFilter').addEventListener('click', openChartFilterModal);
document.getElementById('btnCloseChartFilter').addEventListener('click', () => {
  closeChartFilterModal();
});
chartFilterModal.addEventListener('click', (e) => { if (e.target === chartFilterModal) closeChartFilterModal(); });

document.getElementById('btnApplyChartFilter').addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('#chartFilterList input[type="checkbox"]');
  const excluded = [];
  checkboxes.forEach(cb => {
    if (!cb.checked) excluded.push(cb.dataset.cat);
  });
  state.chartExcluded = excluded;
  saveState();
  renderChart();
  closeChartFilterModal();
});

/* ---------- 設定モーダル ---------- */

const settingsModal = document.getElementById('settingsModal');

function openSettingsModal() {
  renderCategoryManageList();
  renderMemoPresetManageList();

  document.getElementById('rateModeFixed').checked = state.settings.rateMode === 'fixed';
  document.getElementById('rateModeLive').checked = state.settings.rateMode === 'live';
  document.getElementById('fixedRateInput').value = state.settings.fixedRate;
  updateLiveRateInfo();

  document.getElementById('tripStart').value = state.settings.tripStart;
  document.getElementById('tripEnd').value = state.settings.tripEnd;

  settingsModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
  settingsModal.hidden = true;
  document.body.style.overflow = '';
}

document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettingsModal(); });

function updateLiveRateInfo() {
  const info = document.getElementById('liveRateInfo');
  if (state.settings.liveRate) {
    info.textContent = `最新レート: €1 = ¥${state.settings.liveRate.toFixed(2)}（取得日: ${state.settings.liveRateDate}）`;
  } else {
    info.textContent = '最新レートはまだ取得していません';
  }
}

/* --- カテゴリ管理 --- */

function renderCategoryManageList() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  state.categories.forEach(cat => {
    const usageCount = state.expenses.filter(e => e.categoryId === cat.id).length;
    const li = document.createElement('li');
    li.className = 'manage-row';
    li.innerHTML = `
      <span class="manage-name">${cat.icon ? escapeHtml(cat.icon) + ' ' : ''}${escapeHtml(cat.name)}</span>
      <button type="button" class="row-btn" data-action="edit" data-id="${escapeHtml(cat.id)}">✏️</button>
      <button type="button" class="row-btn" data-action="delete" data-id="${escapeHtml(cat.id)}">🗑️</button>
    `;
    list.appendChild(li);

    li.querySelector('[data-action="edit"]').addEventListener('click', () => startEditCategory(li, cat));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCategory(cat.id, usageCount));
  });
}

function startEditCategory(li, cat) {
  li.innerHTML = `
    <input type="text" class="edit-input" value="${escapeHtml(cat.name)}" maxlength="20">
    <button type="button" class="row-btn" data-action="save">✔️</button>
    <button type="button" class="row-btn" data-action="cancel">✖️</button>
  `;
  const input = li.querySelector('.edit-input');
  input.focus();
  input.select();

  li.querySelector('[data-action="cancel"]').addEventListener('click', renderCategoryManageList);
  const save = () => {
    const newName = input.value.trim();
    if (!newName) {
      showToast('カテゴリ名を入力してください', true);
      return;
    }
    const dup = state.categories.some(c => c.id !== cat.id && c.name === newName);
    if (dup) {
      showToast('同名のカテゴリが既にあります', true);
      return;
    }
    cat.name = newName;
    saveState();
    renderCategoryManageList();
    render();
    showToast('カテゴリ名を更新しました');
  };
  li.querySelector('[data-action="save"]').addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
}

function deleteCategory(id, usageCount) {
  if (state.categories.length <= 1) {
    showToast('最後の1件のカテゴリは削除できません', true);
    return;
  }
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;

  const desc = usageCount > 0
    ? `このカテゴリは${usageCount}件の支出で使用されています。削除しても過去の支出は残りますが、カテゴリ名は「${cat.name}（削除済み）」と表示され、新しい支出では選べなくなります。`
    : 'このカテゴリを削除します。';

  showConfirm(`「${cat.name}」を削除しますか？`, desc, () => {
    state.categories = state.categories.filter(c => c.id !== id);
    state.deletedCategories.push({ id: cat.id, name: cat.name, icon: cat.icon || null });
    state.chartExcluded = state.chartExcluded.filter(x => x !== id);
    saveState();
    renderCategoryManageList();
    render();
    showToast('カテゴリを削除しました');
  });
}

document.getElementById('btnAddCategory').addEventListener('click', () => {
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  if (!name) {
    showToast('カテゴリ名を入力してください', true);
    return;
  }
  if (state.categories.some(c => c.name === name)) {
    showToast('同名のカテゴリが既にあります', true);
    return;
  }
  state.categories.push({ id: genId(), name, icon: null });
  input.value = '';
  saveState();
  renderCategoryManageList();
  render();
  showToast('カテゴリを追加しました');
});

/* --- よく使うメモ管理 --- */

function renderMemoPresetManageList() {
  const list = document.getElementById('memoPresetList');
  list.innerHTML = '';
  state.memoPresets.forEach((preset, idx) => {
    const li = document.createElement('li');
    li.className = 'manage-row';
    li.innerHTML = `
      <span class="manage-name">${escapeHtml(preset)}</span>
      <button type="button" class="row-btn" data-action="edit">✏️</button>
      <button type="button" class="row-btn" data-action="delete">🗑️</button>
    `;
    list.appendChild(li);

    li.querySelector('[data-action="edit"]').addEventListener('click', () => startEditMemoPreset(li, idx));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMemoPreset(idx));
  });
}

function startEditMemoPreset(li, idx) {
  const current = state.memoPresets[idx];
  li.innerHTML = `
    <input type="text" class="edit-input" value="${escapeHtml(current)}" maxlength="30">
    <button type="button" class="row-btn" data-action="save">✔️</button>
    <button type="button" class="row-btn" data-action="cancel">✖️</button>
  `;
  const input = li.querySelector('.edit-input');
  input.focus();
  input.select();

  li.querySelector('[data-action="cancel"]').addEventListener('click', renderMemoPresetManageList);
  const save = () => {
    const newVal = input.value.trim();
    if (!newVal) {
      showToast('候補を入力してください', true);
      return;
    }
    const dup = state.memoPresets.some((p, i) => i !== idx && p === newVal);
    if (dup) {
      showToast('同じ候補が既にあります', true);
      return;
    }
    state.memoPresets[idx] = newVal;
    saveState();
    renderMemoPresetManageList();
    showToast('候補を更新しました');
  };
  li.querySelector('[data-action="save"]').addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
}

function deleteMemoPreset(idx) {
  const preset = state.memoPresets[idx];
  showConfirm(`「${preset}」を削除しますか？`, '', () => {
    state.memoPresets.splice(idx, 1);
    saveState();
    renderMemoPresetManageList();
    showToast('候補を削除しました');
  });
}

document.getElementById('btnAddMemoPreset').addEventListener('click', () => {
  const input = document.getElementById('newMemoPreset');
  const val = input.value.trim();
  if (!val) {
    showToast('候補を入力してください', true);
    return;
  }
  if (state.memoPresets.includes(val)) {
    showToast('同じ候補が既にあります', true);
    return;
  }
  state.memoPresets.push(val);
  input.value = '';
  saveState();
  renderMemoPresetManageList();
  showToast('候補を追加しました');
});

/* --- 為替レート --- */

document.getElementById('btnFetchRate').addEventListener('click', async () => {
  const btn = document.getElementById('btnFetchRate');
  if (!navigator.onLine) {
    showToast('オフラインのため最新レートを取得できません', true);
    return;
  }
  btn.disabled = true;
  btn.textContent = '取得中...';
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY');
    if (!res.ok) throw new Error('APIエラー');
    const data = await res.json();
    const rate = data && data.rates && data.rates.JPY;
    if (typeof rate !== 'number' || rate <= 0) throw new Error('不正なレート');
    state.settings.liveRate = rate;
    state.settings.liveRateDate = data.date || todayStr();
    state.settings.rateMode = 'live';
    document.getElementById('rateModeLive').checked = true;
    saveState();
    updateLiveRateInfo();
    showToast('最新レートを取得しました');
  } catch (e) {
    console.error(e);
    showToast('最新レートの取得に失敗しました。保存済みのデータは変更されていません', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '最新レートを取得';
  }
});

/* --- 設定保存 --- */

document.getElementById('btnSaveSettings').addEventListener('click', () => {
  const rateMode = document.getElementById('rateModeLive').checked ? 'live' : 'fixed';
  const fixedRateVal = parseFloat(document.getElementById('fixedRateInput').value.replace(',', '.'));

  if (isNaN(fixedRateVal) || fixedRateVal < 1) {
    showToast('固定レートは1円以上の数値で入力してください', true);
    return;
  }
  if (rateMode === 'live' && !state.settings.liveRate) {
    showToast('最新レートがまだ取得されていません。先に取得してください', true);
    return;
  }

  const tripStart = document.getElementById('tripStart').value;
  const tripEnd = document.getElementById('tripEnd').value;
  if (!tripStart || !tripEnd) {
    showToast('留学開始日・終了日を入力してください', true);
    return;
  }
  if (tripEnd < tripStart) {
    showToast('終了日は開始日より後の日付にしてください', true);
    return;
  }

  state.settings.rateMode = rateMode;
  state.settings.fixedRate = Math.round(fixedRateVal * 100) / 100;
  state.settings.tripStart = tripStart;
  state.settings.tripEnd = tripEnd;

  saveState();
  render();
  showToast('設定を保存しました');
  closeSettingsModal();
});

/* ---------- CSV バックアップ ---------- */

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const header = ['id', 'date', 'amount_eur', 'category', 'category_name', 'memo', 'created_at'];
  const rows = [header.map(csvEscape).join(',')];

  state.expenses.forEach(exp => {
    const catName = (() => {
      const c = state.categories.find(x => x.id === exp.categoryId) ||
        state.deletedCategories.find(x => x.id === exp.categoryId);
      return c ? c.name : (exp.categoryNameSnapshot || '');
    })();
    rows.push([
      exp.id,
      exp.date,
      exp.amountEur.toFixed(2),
      exp.categoryId,
      catName,
      exp.memo || '',
      new Date(exp.createdAt).toISOString()
    ].map(csvEscape).join(','));
  });

  const csvContent = rows.join('\r\n');
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = todayStr();
  a.href = url;
  a.download = `barcelona-kakeibo-${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('CSVを書き出しました');
}

document.getElementById('btnExportCsv').addEventListener('click', exportCsv);

document.getElementById('btnImportCsvTrigger').addEventListener('click', () => {
  document.getElementById('importCsvFile').click();
});

document.getElementById('importCsvFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const result = parseCsvAndImport(text);
    showToast(`${result.imported}件のデータを読み込みました（重複スキップ: ${result.skipped}件）`);
    saveState();
    render();
  } catch (err) {
    console.error(err);
    showToast(`CSVの読み込みに失敗しました: ${err.message}`, true);
  }
});

function parseCsvRows(text) {
  // BOM除去
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\r') {
        // skip, handle \r\n and lone \r
        if (text[i + 1] === '\n') continue;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else if (ch === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

function parseCsvAndImport(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 1) throw new Error('空のファイルです');

  const header = rows[0].map(h => h.trim());
  const required = ['id', 'date', 'amount_eur', 'category', 'category_name', 'memo', 'created_at'];
  for (const col of required) {
    if (!header.includes(col)) throw new Error(`必須列「${col}」がありません`);
  }
  const idx = {};
  required.forEach(col => { idx[col] = header.indexOf(col); });

  const existingIds = new Set(state.expenses.map(e => e.id));
  let imported = 0, skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 0 || (r.length === 1 && r[0].trim() === '')) continue;

    const id = (r[idx.id] || '').trim();
    const date = (r[idx.date] || '').trim();
    const amountStr = (r[idx.amount_eur] || '').trim();
    const categoryId = (r[idx.category] || '').trim();
    const categoryName = (r[idx.category_name] || '').trim();
    const memo = (r[idx.memo] || '').slice(0, 60);
    const createdAtStr = (r[idx.created_at] || '').trim();

    if (!id) throw new Error(`${i + 1}行目: idが空です`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${i + 1}行目: 日付の形式が不正です`);
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) throw new Error(`${i + 1}行目: 金額が不正です`);
    if (!categoryId) throw new Error(`${i + 1}行目: categoryが空です`);

    if (existingIds.has(id)) { skipped++; continue; }

    // カテゴリの復元: 既存 or 削除済みに無ければ category_name を使って復元
    let cat = state.categories.find(c => c.id === categoryId) ||
      state.deletedCategories.find(c => c.id === categoryId);
    if (!cat && categoryName) {
      // 同名の現行カテゴリがあればそれを使う
      const byName = state.categories.find(c => c.name === categoryName);
      if (byName) {
        cat = byName;
      } else {
        // 新規カテゴリとしてIDそのままで復元登録（削除済み扱いにはしない：未知だが有効データとして扱う）
        const restored = { id: categoryId, name: categoryName, icon: null };
        state.categories.push(restored);
        cat = restored;
      }
    }

    state.expenses.push({
      id,
      date,
      amountEur: Math.round(amount * 100) / 100,
      categoryId: cat ? cat.id : categoryId,
      categoryNameSnapshot: categoryName || (cat ? cat.name : ''),
      memo,
      createdAt: createdAtStr ? Date.parse(createdAtStr) || Date.now() : Date.now()
    });
    existingIds.add(id);
    imported++;
  }

  return { imported, skipped };
}

/* ---------- 確認ダイアログ ---------- */

const confirmModal = document.getElementById('confirmModal');
let confirmCallback = null;

function showConfirm(title, desc, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmDesc').textContent = desc || '';
  confirmCallback = onOk;
  confirmModal.hidden = false;
}

document.getElementById('confirmCancel').addEventListener('click', () => {
  confirmModal.hidden = true;
  confirmCallback = null;
});

document.getElementById('confirmOk').addEventListener('click', () => {
  confirmModal.hidden = true;
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
});

/* ---------- トースト通知 ---------- */

let toastTimer = null;
function showToast(message, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

/* ---------- オンライン/オフライン通知 ---------- */

window.addEventListener('online', () => showToast('オンラインに復帰しました'));
window.addEventListener('offline', () => showToast('オフラインになりました。引き続き入力できます'));

/* ---------- Service Worker 登録 ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.error('Service Worker 登録に失敗しました', err);
    });
  });
}

/* ---------- 初期化 ---------- */

render();
