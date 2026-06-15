const state = {
  teachers: [],
  schedules: [],
  currentScheduleId: null,
  detail: null,
};

// ---------- helpers ----------

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}時${m}分`;
  if (h) return `${h}時`;
  return `${m}分`;
}

let toastTimer;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- tabs ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    switchTab(btn.dataset.tab);
  });
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === 'tab-' + tab));
}

// ---------- teachers ----------

async function loadTeachers() {
  state.teachers = await api('GET', '/teachers');
  renderTeachers();
  if (state.currentScheduleId) renderEditor();
}

function renderTeachers() {
  const tbody = document.getElementById('teacherTableBody');
  if (state.teachers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">尚未新增老師</td></tr>';
    return;
  }
  tbody.innerHTML = state.teachers.map((t) => `
    <tr>
      <td><input type="text" class="teacher-name" data-id="${t.id}" value="${escapeHtml(t.name)}"></td>
      <td style="text-align:center"><input type="checkbox" class="teacher-active" data-id="${t.id}" ${t.active ? 'checked' : ''}></td>
      <td><button class="danger small teacher-delete" data-id="${t.id}">刪除</button></td>
    </tr>
  `).join('');
}

document.getElementById('addTeacherForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('newTeacherName');
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('POST', '/teachers', { name });
    input.value = '';
    input.focus();
    await loadTeachers();
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('teacherTableBody').addEventListener('change', async (e) => {
  const el = e.target;
  const id = el.dataset.id;
  try {
    if (el.classList.contains('teacher-name')) {
      const name = el.value.trim();
      if (!name) { showToast('姓名不能為空', true); await loadTeachers(); return; }
      await api('PUT', `/teachers/${id}`, { name });
      await loadTeachers();
    } else if (el.classList.contains('teacher-active')) {
      await api('PUT', `/teachers/${id}`, { active: el.checked });
      await loadTeachers();
    }
  } catch (err) {
    showToast(err.message, true);
    await loadTeachers();
  }
});

document.getElementById('teacherTableBody').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('teacher-delete')) return;
  if (!confirm('確定要刪除這位老師嗎？')) return;
  await api('DELETE', `/teachers/${e.target.dataset.id}`);
  await loadTeachers();
});

// ---------- schedules ----------

async function loadSchedules() {
  state.schedules = await api('GET', '/schedules');
  renderSchedules();
}

function renderSchedules() {
  const tbody = document.getElementById('scheduleTableBody');
  if (state.schedules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">尚未新增值勤表</td></tr>';
    return;
  }
  tbody.innerHTML = state.schedules.map((s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.date || ''}</td>
      <td>
        <button class="small primary schedule-open" data-id="${s.id}">開啟</button>
        <button class="small schedule-duplicate" data-id="${s.id}">複製</button>
        <button class="small danger schedule-delete" data-id="${s.id}">刪除</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('addScheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('newScheduleName');
  const dateInput = document.getElementById('newScheduleDate');
  const name = nameInput.value.trim();
  if (!name) return;
  try {
    const detail = await api('POST', '/schedules', { name, date: dateInput.value || null });
    nameInput.value = '';
    dateInput.value = '';
    await loadSchedules();
    await openSchedule(detail.schedule.id);
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('scheduleTableBody').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  try {
    if (e.target.classList.contains('schedule-open')) {
      await openSchedule(id);
    } else if (e.target.classList.contains('schedule-duplicate')) {
      const src = state.schedules.find((s) => String(s.id) === id);
      const name = prompt('新表格名稱：', (src ? src.name : '') + ' (複製)');
      if (name === null || !name.trim()) return;
      const date = prompt('新表格日期 (YYYY-MM-DD，留空則沿用原日期)：', src && src.date ? src.date : '');
      if (date === null) return;
      const detail = await api('POST', `/schedules/${id}/duplicate`, { name: name.trim(), date: date || (src ? src.date : null) });
      await loadSchedules();
      await openSchedule(detail.schedule.id);
      showToast('已複製表格，可在此基礎上修改');
    } else if (e.target.classList.contains('schedule-delete')) {
      if (!confirm('確定要刪除這個值勤表嗎？此操作無法復原。')) return;
      await api('DELETE', `/schedules/${id}`);
      if (state.currentScheduleId === Number(id)) {
        state.currentScheduleId = null;
        state.detail = null;
        document.getElementById('editorTabBtn').disabled = true;
        switchTab('schedules');
      }
      await loadSchedules();
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- editor ----------

async function openSchedule(id) {
  state.currentScheduleId = Number(id);
  document.getElementById('editorTabBtn').disabled = false;
  await loadDetail();
  switchTab('editor');
}

async function loadDetail() {
  state.detail = await api('GET', `/schedules/${state.currentScheduleId}`);
  renderEditor();
}

function renderEditor() {
  if (!state.detail) return;
  const { schedule, timeSlots } = state.detail;
  document.getElementById('scheduleName').value = schedule.name;
  document.getElementById('scheduleDate').value = schedule.date || '';
  renderSlots(timeSlots);
  renderResults(timeSlots);
}

document.getElementById('scheduleMetaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('scheduleName').value.trim();
  const date = document.getElementById('scheduleDate').value;
  if (!name) return;
  try {
    state.detail = await api('PUT', `/schedules/${state.currentScheduleId}`, { name, date: date || null });
    await loadSchedules();
    showToast('已儲存');
  } catch (err) {
    showToast(err.message, true);
  }
});

document.getElementById('addSlotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const labelInput = document.getElementById('slotLabel');
  const startInput = document.getElementById('slotStart');
  const endInput = document.getElementById('slotEnd');
  const label = labelInput.value.trim();
  const start_time = startInput.value;
  const end_time = endInput.value;
  if (!label || !start_time || !end_time) return;
  if (start_time >= end_time) { showToast('結束時間必須在開始時間之後', true); return; }
  try {
    state.detail = await api('POST', `/schedules/${state.currentScheduleId}/slots`, { label, start_time, end_time });
    labelInput.value = '';
    startInput.value = '';
    endInput.value = '';
    renderEditor();
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- slot / duty / unavailability blocks ----------

function renderSlots(timeSlots) {
  const container = document.getElementById('slotsContainer');
  if (timeSlots.length === 0) {
    container.innerHTML = '<p class="empty-msg">尚未新增時段，請在上方新增。</p>';
    return;
  }
  container.innerHTML = timeSlots.map(slotBlockHtml).join('');
}

function slotBlockHtml(slot) {
  const unavailableIds = new Set(slot.unavailable.map((u) => u.teacher_id));
  const availableTeachers = state.teachers.filter((t) => !unavailableIds.has(t.id));

  const dutyRows = slot.duties.map((d) => `
    <tr data-duty-id="${d.id}">
      <td><input type="text" class="duty-name" data-duty-id="${d.id}" value="${escapeHtml(d.name)}"></td>
      <td class="needed-cell"><input type="number" min="1" class="duty-needed" data-duty-id="${d.id}" value="${d.needed_count}"></td>
      <td><button class="danger small duty-delete" data-duty-id="${d.id}">刪除</button></td>
    </tr>
  `).join('');

  const chips = slot.unavailable.map((u) => `
    <span class="chip">${escapeHtml(u.teacher_name)}<button class="chip-remove" data-slot-id="${slot.id}" data-teacher-id="${u.teacher_id}" title="移除">&times;</button></span>
  `).join('');

  return `
    <div class="slot-block" data-slot-id="${slot.id}">
      <div class="slot-header">
        <input type="text" class="slot-label" data-slot-id="${slot.id}" value="${escapeHtml(slot.label)}" placeholder="時段名稱">
        <input type="time" class="slot-start" data-slot-id="${slot.id}" value="${slot.start_time}">
        <span>至</span>
        <input type="time" class="slot-end" data-slot-id="${slot.id}" value="${slot.end_time}">
        <span class="slot-time">(${slot.duration_min} 分鐘)</span>
        <span class="spacer"></span>
        <button class="danger small slot-delete" data-slot-id="${slot.id}">刪除時段</button>
      </div>
      <div class="duty-list">
        <table class="data-table">
          <thead><tr><th>職務名稱</th><th>需要人數</th><th></th></tr></thead>
          <tbody>
            ${dutyRows || '<tr><td colspan="3" class="empty-msg">尚未新增職務</td></tr>'}
          </tbody>
        </table>
        <form class="add-duty-form inline-form" data-slot-id="${slot.id}">
          <input type="text" placeholder="職務名稱 (例如：操場巡查)" required>
          <input type="number" min="1" value="1" title="需要人數">
          <button type="submit" class="small">新增職務</button>
        </form>
      </div>
      <div class="unavailable-row">
        <span>此時段不可值勤：</span>
        <div class="chips">${chips || ''}</div>
        <select class="add-unavailable" data-slot-id="${slot.id}">
          <option value="">+ 加入老師</option>
          ${availableTeachers.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
        </select>
      </div>
    </div>
  `;
}

const slotsContainer = document.getElementById('slotsContainer');

slotsContainer.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.classList.contains('slot-label') || el.classList.contains('slot-start') || el.classList.contains('slot-end')) {
      const block = el.closest('.slot-block');
      const slotId = block.dataset.slotId;
      const label = block.querySelector('.slot-label').value.trim();
      const start_time = block.querySelector('.slot-start').value;
      const end_time = block.querySelector('.slot-end').value;
      if (start_time >= end_time) { showToast('結束時間必須在開始時間之後', true); await loadDetail(); return; }
      state.detail = await api('PUT', `/slots/${slotId}`, { label, start_time, end_time });
      renderEditor();
    } else if (el.classList.contains('duty-name') || el.classList.contains('duty-needed')) {
      const row = el.closest('tr');
      const dutyId = row.dataset.dutyId;
      const name = row.querySelector('.duty-name').value.trim();
      const needed_count = row.querySelector('.duty-needed').value;
      if (!name) { showToast('職務名稱不能為空', true); await loadDetail(); return; }
      state.detail = await api('PUT', `/duties/${dutyId}`, { name, needed_count });
      renderEditor();
    } else if (el.classList.contains('add-unavailable')) {
      const slotId = el.dataset.slotId;
      const teacherId = el.value;
      if (!teacherId) return;
      state.detail = await api('POST', `/slots/${slotId}/unavailable`, { teacher_id: teacherId });
      renderEditor();
    }
  } catch (err) {
    showToast(err.message, true);
    await loadDetail();
  }
});

slotsContainer.addEventListener('click', async (e) => {
  const el = e.target;
  try {
    if (el.classList.contains('slot-delete')) {
      if (!confirm('確定要刪除這個時段嗎？相關職務及分配紀錄將一併刪除。')) return;
      state.detail = await api('DELETE', `/slots/${el.dataset.slotId}`);
      renderEditor();
    } else if (el.classList.contains('duty-delete')) {
      if (!confirm('確定要刪除這個職務嗎？')) return;
      state.detail = await api('DELETE', `/duties/${el.dataset.dutyId}`);
      renderEditor();
    } else if (el.classList.contains('chip-remove')) {
      state.detail = await api('DELETE', `/slots/${el.dataset.slotId}/unavailable/${el.dataset.teacherId}`);
      renderEditor();
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

slotsContainer.addEventListener('submit', async (e) => {
  if (!e.target.classList.contains('add-duty-form')) return;
  e.preventDefault();
  const form = e.target;
  const slotId = form.dataset.slotId;
  const nameInput = form.querySelector('input[type="text"]');
  const countInput = form.querySelector('input[type="number"]');
  const name = nameInput.value.trim();
  const needed_count = countInput.value || 1;
  if (!name) return;
  try {
    state.detail = await api('POST', `/slots/${slotId}/duties`, { name, needed_count });
    renderEditor();
  } catch (err) {
    showToast(err.message, true);
  }
});

// ---------- generate & results ----------

document.getElementById('generateBtn').addEventListener('click', async () => {
  if (!state.currentScheduleId) return;
  try {
    state.detail = await api('POST', `/schedules/${state.currentScheduleId}/generate`);
    renderResults(state.detail.timeSlots);
    showToast('已完成平均分配，可在下方手動調整');
  } catch (err) {
    showToast(err.message, true);
  }
});

function renderResults(timeSlots) {
  const hasDuty = timeSlots.some((s) => s.duties.length > 0);
  const resultCard = document.getElementById('resultCard');
  const previewCard = document.getElementById('previewCard');
  if (!hasDuty) {
    resultCard.style.display = 'none';
    previewCard.style.display = 'none';
    return;
  }
  resultCard.style.display = '';
  previewCard.style.display = '';
  renderAssignmentTable(timeSlots);
  renderPreviewTable(timeSlots);
}

function renderAssignmentTable(timeSlots) {
  const tbody = document.getElementById('assignmentTableBody');
  const rows = [];
  for (const slot of timeSlots) {
    for (const duty of slot.duties) {
      for (const a of duty.assignments) {
        rows.push({ slot, duty, a });
      }
    }
  }
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">尚未設定職務</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(({ slot, duty, a }) => `
    <tr>
      <td>${escapeHtml(slot.label)}<br><small class="hint">${slot.start_time}-${slot.end_time}</small></td>
      <td>${slot.duration_min} 分</td>
      <td>${escapeHtml(duty.name)}</td>
      <td>${duty.needed_count > 1 ? (a.slot_index + 1) + ' / ' + duty.needed_count : '-'}</td>
      <td>
        <select class="assignment-select" data-assignment-id="${a.id}">
          <option value="">未分配</option>
          ${state.teachers.map((t) => `<option value="${t.id}" ${t.id === a.teacher_id ? 'selected' : ''}>${escapeHtml(t.name)}${t.active ? '' : ' (假)'}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('');
}

document.getElementById('assignmentTableBody').addEventListener('change', async (e) => {
  const el = e.target;
  if (!el.classList.contains('assignment-select')) return;
  try {
    state.detail = await api('PUT', `/assignments/${el.dataset.assignmentId}`, { teacher_id: el.value || null });
    renderResults(state.detail.timeSlots);
  } catch (err) {
    showToast(err.message, true);
  }
});

function renderPreviewTable(timeSlots) {
  const table = document.getElementById('previewTable');
  const activeTeachers = state.teachers.filter((t) => t.active);

  const totals = new Map(state.teachers.map((t) => [t.id, { minutes: 0, count: 0 }]));
  const cellMap = new Map();

  for (const slot of timeSlots) {
    for (const duty of slot.duties) {
      for (const a of duty.assignments) {
        if (!a.teacher_id) continue;
        const key = `${a.teacher_id}_${slot.id}`;
        if (!cellMap.has(key)) cellMap.set(key, []);
        cellMap.get(key).push(duty.name);
        const t = totals.get(a.teacher_id);
        if (t) { t.minutes += slot.duration_min; t.count += 1; }
      }
    }
  }

  let html = '<thead><tr><th>老師</th>';
  for (const slot of timeSlots) {
    html += `<th class="slot-head">${escapeHtml(slot.label)}<small>${slot.start_time}-${slot.end_time}</small></th>`;
  }
  html += '<th>總值勤時數</th><th>總次數</th></tr></thead><tbody>';

  if (activeTeachers.length === 0) {
    html += `<tr><td colspan="${timeSlots.length + 3}" class="empty-msg">尚未新增在職老師</td></tr>`;
  } else {
    for (const t of activeTeachers) {
      html += `<tr><td>${escapeHtml(t.name)}</td>`;
      for (const slot of timeSlots) {
        const cell = cellMap.get(`${t.id}_${slot.id}`) || [];
        html += `<td>${cell.map(escapeHtml).join('<br>') || '-'}</td>`;
      }
      const total = totals.get(t.id);
      html += `<td class="total-cell">${formatMinutes(total.minutes)}</td><td class="total-cell">${total.count}</td>`;
      html += '</tr>';
    }
  }
  html += '</tbody>';
  table.innerHTML = html;
}

document.getElementById('exportDocxBtn').addEventListener('click', () => {
  if (!state.currentScheduleId) return;
  window.location.href = `/api/schedules/${state.currentScheduleId}/export.docx`;
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const table = document.getElementById('previewTable');
  const rows = [...table.querySelectorAll('tr')].map((row) =>
    [...row.children].map((cell) => {
      let text = cell.innerText.replace(/\s+/g, ' ').trim();
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }).join(',')
  );
  const csv = rows.join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = (state.detail.schedule.name || 'schedule').replace(/[\\/:*?"<>|]/g, '_');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('printBtn').addEventListener('click', () => window.print());

// ---------- init ----------

(async function init() {
  await loadTeachers();
  await loadSchedules();
})();
