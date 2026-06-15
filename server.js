const path = require('node:path');
const express = require('express');
const db = require('./db');
const { generateAssignments, durationMinutes } = require('./lib/scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function syncDutySeats(dutyId, neededCount) {
  db.prepare('DELETE FROM assignments WHERE duty_id = ? AND slot_index >= ?').run(dutyId, neededCount);
  const existing = db
    .prepare('SELECT slot_index FROM assignments WHERE duty_id = ?')
    .all(dutyId)
    .map((r) => r.slot_index);
  for (let i = 0; i < neededCount; i++) {
    if (!existing.includes(i)) {
      db.prepare('INSERT INTO assignments (duty_id, slot_index, teacher_id) VALUES (?, ?, NULL)').run(dutyId, i);
    }
  }
}

function getScheduleDetail(scheduleId) {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!schedule) return null;

  const slots = db
    .prepare('SELECT * FROM time_slots WHERE schedule_id = ? ORDER BY start_time, id')
    .all(scheduleId);

  const timeSlots = slots.map((slot) => {
    const duties = db
      .prepare('SELECT * FROM duties WHERE time_slot_id = ? ORDER BY id')
      .all(slot.id)
      .map((duty) => {
        const assignments = db
          .prepare(
            `SELECT a.id, a.slot_index, a.teacher_id, t.name AS teacher_name
             FROM assignments a
             LEFT JOIN teachers t ON t.id = a.teacher_id
             WHERE a.duty_id = ? ORDER BY a.slot_index`
          )
          .all(duty.id);
        return { ...duty, assignments };
      });

    const unavailable = db
      .prepare(
        `SELECT u.teacher_id, t.name AS teacher_name
         FROM unavailability u JOIN teachers t ON t.id = u.teacher_id
         WHERE u.time_slot_id = ? ORDER BY t.sort_order, t.id`
      )
      .all(slot.id);

    return {
      ...slot,
      duration_min: durationMinutes(slot.start_time, slot.end_time),
      duties,
      unavailable,
    };
  });

  return { schedule, timeSlots };
}

// ---------- teachers ----------

app.get('/api/teachers', (req, res) => {
  const teachers = db.prepare('SELECT * FROM teachers ORDER BY sort_order, id').all();
  res.json(teachers);
});

app.post('/api/teachers', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '請輸入老師姓名' });
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM teachers').get().m;
    const r = db
      .prepare('INSERT INTO teachers (name, sort_order) VALUES (?, ?)')
      .run(name, maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM teachers WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: '老師姓名已存在' });
  }
});

app.put('/api/teachers/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '找不到老師' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : t.name;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : t.active;
  if (!name) return res.status(400).json({ error: '請輸入老師姓名' });
  try {
    db.prepare('UPDATE teachers SET name = ?, active = ? WHERE id = ?').run(name, active, req.params.id);
    res.json(db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id));
  } catch (e) {
    res.status(400).json({ error: '老師姓名已存在' });
  }
});

app.delete('/api/teachers/:id', (req, res) => {
  db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- schedules ----------

app.get('/api/schedules', (req, res) => {
  res.json(db.prepare('SELECT * FROM schedules ORDER BY date DESC, id DESC').all());
});

app.post('/api/schedules', (req, res) => {
  const name = (req.body.name || '').trim();
  const date = req.body.date || null;
  if (!name) return res.status(400).json({ error: '請輸入表格名稱' });
  const r = db.prepare('INSERT INTO schedules (name, date) VALUES (?, ?)').run(name, date);
  res.status(201).json(getScheduleDetail(r.lastInsertRowid));
});

app.get('/api/schedules/:id', (req, res) => {
  const detail = getScheduleDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '找不到表格' });
  res.json(detail);
});

app.put('/api/schedules/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到表格' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : s.name;
  const date = req.body.date !== undefined ? req.body.date : s.date;
  db.prepare('UPDATE schedules SET name = ?, date = ? WHERE id = ?').run(name, date, req.params.id);
  res.json(getScheduleDetail(req.params.id));
});

app.delete('/api/schedules/:id', (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.post('/api/schedules/:id/duplicate', (req, res) => {
  const src = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: '找不到表格' });

  const name = (req.body.name || src.name).trim();
  const date = req.body.date !== undefined ? req.body.date : src.date;
  const newId = db.prepare('INSERT INTO schedules (name, date) VALUES (?, ?)').run(name, date).lastInsertRowid;

  const slots = db.prepare('SELECT * FROM time_slots WHERE schedule_id = ? ORDER BY start_time, id').all(src.id);
  for (const slot of slots) {
    const newSlotId = db
      .prepare('INSERT INTO time_slots (schedule_id, label, start_time, end_time) VALUES (?, ?, ?, ?)')
      .run(newId, slot.label, slot.start_time, slot.end_time).lastInsertRowid;

    const duties = db.prepare('SELECT * FROM duties WHERE time_slot_id = ? ORDER BY id').all(slot.id);
    for (const duty of duties) {
      const newDutyId = db
        .prepare('INSERT INTO duties (time_slot_id, name, needed_count) VALUES (?, ?, ?)')
        .run(newSlotId, duty.name, duty.needed_count).lastInsertRowid;
      syncDutySeats(newDutyId, duty.needed_count);
    }

    const unavail = db.prepare('SELECT teacher_id FROM unavailability WHERE time_slot_id = ?').all(slot.id);
    for (const u of unavail) {
      db.prepare('INSERT OR IGNORE INTO unavailability (time_slot_id, teacher_id) VALUES (?, ?)').run(
        newSlotId,
        u.teacher_id
      );
    }
  }

  res.status(201).json(getScheduleDetail(newId));
});

// ---------- time slots ----------

app.post('/api/schedules/:id/slots', (req, res) => {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: '找不到表格' });

  const { label, start_time, end_time } = req.body;
  if (!label || !start_time || !end_time) {
    return res.status(400).json({ error: '請輸入時段名稱、開始及結束時間' });
  }
  db.prepare('INSERT INTO time_slots (schedule_id, label, start_time, end_time) VALUES (?, ?, ?, ?)').run(
    req.params.id,
    label,
    start_time,
    end_time
  );
  res.status(201).json(getScheduleDetail(req.params.id));
});

app.put('/api/slots/:id', (req, res) => {
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  const label = req.body.label !== undefined ? req.body.label : slot.label;
  const start_time = req.body.start_time !== undefined ? req.body.start_time : slot.start_time;
  const end_time = req.body.end_time !== undefined ? req.body.end_time : slot.end_time;
  db.prepare('UPDATE time_slots SET label = ?, start_time = ?, end_time = ? WHERE id = ?').run(
    label,
    start_time,
    end_time,
    req.params.id
  );
  res.json(getScheduleDetail(slot.schedule_id));
});

app.delete('/api/slots/:id', (req, res) => {
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  db.prepare('DELETE FROM time_slots WHERE id = ?').run(req.params.id);
  res.json(getScheduleDetail(slot.schedule_id));
});

// ---------- duties ----------

app.post('/api/slots/:id/duties', (req, res) => {
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ error: '找不到時段' });

  const name = (req.body.name || '').trim();
  const needed_count = Math.max(1, parseInt(req.body.needed_count, 10) || 1);
  if (!name) return res.status(400).json({ error: '請輸入職務名稱' });

  const r = db
    .prepare('INSERT INTO duties (time_slot_id, name, needed_count) VALUES (?, ?, ?)')
    .run(slot.id, name, needed_count);
  syncDutySeats(r.lastInsertRowid, needed_count);

  res.status(201).json(getScheduleDetail(slot.schedule_id));
});

app.put('/api/duties/:id', (req, res) => {
  const duty = db.prepare('SELECT * FROM duties WHERE id = ?').get(req.params.id);
  if (!duty) return res.status(404).json({ error: '找不到職務' });
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(duty.time_slot_id);

  const name = req.body.name !== undefined ? String(req.body.name).trim() : duty.name;
  const needed_count =
    req.body.needed_count !== undefined ? Math.max(1, parseInt(req.body.needed_count, 10) || 1) : duty.needed_count;
  if (!name) return res.status(400).json({ error: '請輸入職務名稱' });

  db.prepare('UPDATE duties SET name = ?, needed_count = ? WHERE id = ?').run(name, needed_count, duty.id);
  syncDutySeats(duty.id, needed_count);

  res.json(getScheduleDetail(slot.schedule_id));
});

app.delete('/api/duties/:id', (req, res) => {
  const duty = db.prepare('SELECT * FROM duties WHERE id = ?').get(req.params.id);
  if (!duty) return res.status(404).json({ error: '找不到職務' });
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(duty.time_slot_id);
  db.prepare('DELETE FROM duties WHERE id = ?').run(duty.id);
  res.json(getScheduleDetail(slot.schedule_id));
});

// ---------- unavailability ----------

app.post('/api/slots/:id/unavailable', (req, res) => {
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  const teacherId = parseInt(req.body.teacher_id, 10);
  if (!teacherId) return res.status(400).json({ error: '請選擇老師' });
  db.prepare('INSERT OR IGNORE INTO unavailability (time_slot_id, teacher_id) VALUES (?, ?)').run(slot.id, teacherId);
  res.json(getScheduleDetail(slot.schedule_id));
});

app.delete('/api/slots/:id/unavailable/:teacherId', (req, res) => {
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  db.prepare('DELETE FROM unavailability WHERE time_slot_id = ? AND teacher_id = ?').run(
    slot.id,
    req.params.teacherId
  );
  res.json(getScheduleDetail(slot.schedule_id));
});

// ---------- generate / assignments ----------

app.post('/api/schedules/:id/generate', (req, res) => {
  const detail = getScheduleDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '找不到表格' });

  const teachers = db.prepare('SELECT id, name FROM teachers WHERE active = 1 ORDER BY sort_order, id').all();
  if (teachers.length === 0) {
    return res.status(400).json({ error: '請先新增啟用中的老師' });
  }

  const slotsForAlgo = detail.timeSlots.map((slot) => ({
    id: slot.id,
    start_time: slot.start_time,
    end_time: slot.end_time,
    duties: slot.duties.map((d) => ({ id: d.id, needed_count: d.needed_count })),
    unavailable: new Set(slot.unavailable.map((u) => u.teacher_id)),
  }));

  const results = generateAssignments(teachers, slotsForAlgo);

  for (const r of results) {
    db.prepare('UPDATE assignments SET teacher_id = ? WHERE duty_id = ? AND slot_index = ?').run(
      r.teacher_id,
      r.duty_id,
      r.slot_index
    );
  }

  res.json(getScheduleDetail(req.params.id));
});

app.put('/api/assignments/:id', (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).json({ error: '找不到分配紀錄' });

  const teacherId = req.body.teacher_id === null || req.body.teacher_id === '' ? null : parseInt(req.body.teacher_id, 10);
  db.prepare('UPDATE assignments SET teacher_id = ? WHERE id = ?').run(teacherId, assignment.id);

  const duty = db.prepare('SELECT * FROM duties WHERE id = ?').get(assignment.duty_id);
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(duty.time_slot_id);
  res.json(getScheduleDetail(slot.schedule_id));
});

// ---------- summary ----------

app.get('/api/schedules/:id/summary', (req, res) => {
  const detail = getScheduleDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '找不到表格' });

  const teachers = db.prepare('SELECT id, name, active FROM teachers ORDER BY sort_order, id').all();
  const totals = new Map(teachers.map((t) => [t.id, { teacher_id: t.id, name: t.name, active: t.active, total_minutes: 0, total_count: 0 }]));

  for (const slot of detail.timeSlots) {
    for (const duty of slot.duties) {
      for (const a of duty.assignments) {
        if (a.teacher_id && totals.has(a.teacher_id)) {
          const entry = totals.get(a.teacher_id);
          entry.total_minutes += slot.duration_min;
          entry.total_count += 1;
        }
      }
    }
  }

  res.json([...totals.values()]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Timearrang server running on http://localhost:${PORT}`);
});
