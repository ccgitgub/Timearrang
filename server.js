const path = require('node:path');
const express = require('express');
const { Packer } = require('docx');
const db = require('./db');
const { addDefaultSlotsAndDuties, CLASS_TEACHERS } = require('./lib/db/schema');
const { generateAssignments, durationMinutes } = require('./lib/scheduler');
const { buildScheduleDocument } = require('./lib/exportDocx');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// 將 async route handler 的錯誤導向 Express 錯誤處理中介層
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- helpers ----------

async function syncDutySeats(dutyId, neededCount) {
  await db.run('DELETE FROM assignments WHERE duty_id = ? AND slot_index >= ?', [dutyId, neededCount]);
  const existing = (await db.all('SELECT slot_index FROM assignments WHERE duty_id = ?', [dutyId])).map(
    (r) => r.slot_index
  );
  for (let i = 0; i < neededCount; i++) {
    if (!existing.includes(i)) {
      await db.run('INSERT INTO assignments (duty_id, slot_index, teacher_id) VALUES (?, ?, NULL)', [dutyId, i]);
    }
  }
}

async function getScheduleDetail(scheduleId) {
  const schedule = await db.get('SELECT * FROM schedules WHERE id = ?', [scheduleId]);
  if (!schedule) return null;

  const slots = await db.all('SELECT * FROM time_slots WHERE schedule_id = ? ORDER BY start_time, id', [scheduleId]);

  const timeSlots = [];
  for (const slot of slots) {
    const dutyRows = await db.all('SELECT * FROM duties WHERE time_slot_id = ? ORDER BY id', [slot.id]);
    const duties = [];
    for (const duty of dutyRows) {
      const assignments = await db.all(
        `SELECT a.id, a.slot_index, a.teacher_id, a.locked, t.name AS teacher_name
         FROM assignments a
         LEFT JOIN teachers t ON t.id = a.teacher_id
         WHERE a.duty_id = ? ORDER BY a.slot_index`,
        [duty.id]
      );
      duties.push({ ...duty, assignments });
    }

    const unavailable = await db.all(
      `SELECT u.teacher_id, t.name AS teacher_name
       FROM unavailability u JOIN teachers t ON t.id = u.teacher_id
       WHERE u.time_slot_id = ? ORDER BY t.sort_order, t.id`,
      [slot.id]
    );

    timeSlots.push({
      ...slot,
      duration_min: durationMinutes(slot.start_time, slot.end_time),
      duties,
      unavailable,
    });
  }

  return { schedule, timeSlots };
}

// ---------- teachers ----------

app.get('/api/teachers', wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM teachers ORDER BY sort_order, id'));
}));

app.post('/api/teachers', wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '請輸入老師姓名' });
  try {
    const maxOrder = (await db.get('SELECT COALESCE(MAX(sort_order), -1) AS m FROM teachers')).m;
    const r = await db.run('INSERT INTO teachers (name, sort_order) VALUES (?, ?)', [name, maxOrder + 1]);
    res.status(201).json(await db.get('SELECT * FROM teachers WHERE id = ?', [r.lastInsertRowid]));
  } catch (e) {
    res.status(400).json({ error: '老師姓名已存在' });
  }
}));

app.put('/api/teachers/:id', wrap(async (req, res) => {
  const t = await db.get('SELECT * FROM teachers WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: '找不到老師' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : t.name;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : t.active;
  if (!name) return res.status(400).json({ error: '請輸入老師姓名' });
  try {
    await db.run('UPDATE teachers SET name = ?, active = ? WHERE id = ?', [name, active, req.params.id]);
    res.json(await db.get('SELECT * FROM teachers WHERE id = ?', [req.params.id]));
  } catch (e) {
    res.status(400).json({ error: '老師姓名已存在' });
  }
}));

app.delete('/api/teachers/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM teachers WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

// ---------- schedules ----------

app.get('/api/schedules', wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM schedules ORDER BY date DESC, id DESC'));
}));

app.post('/api/schedules', wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  const date = req.body.date || null;
  if (!name) return res.status(400).json({ error: '請輸入表格名稱' });
  const r = await db.run('INSERT INTO schedules (name, date) VALUES (?, ?)', [name, date]);
  await addDefaultSlotsAndDuties(db, r.lastInsertRowid);
  res.status(201).json(await getScheduleDetail(r.lastInsertRowid));
}));

app.get('/api/schedules/:id', wrap(async (req, res) => {
  const detail = await getScheduleDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '找不到表格' });
  res.json(detail);
}));

app.put('/api/schedules/:id', wrap(async (req, res) => {
  const s = await db.get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: '找不到表格' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : s.name;
  const date = req.body.date !== undefined ? req.body.date : s.date;
  await db.run('UPDATE schedules SET name = ?, date = ? WHERE id = ?', [name, date, req.params.id]);
  res.json(await getScheduleDetail(req.params.id));
}));

app.put('/api/schedules/:id/lock-last-slot', wrap(async (req, res) => {
  const schedule = await db.get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
  if (!schedule) return res.status(404).json({ error: '找不到表格' });

  const locked = req.body.locked ? 1 : 0;
  await db.run('UPDATE schedules SET lock_last_slot = ? WHERE id = ?', [locked, schedule.id]);

  // 鎖定目標：時間最晚、且非鏈結時段、且非「排除上一節」時段（即第五節）
  const lastSlot = await db.get(
    'SELECT * FROM time_slots WHERE schedule_id = ? AND (chain_source_label IS NULL) AND (excl_prev_teachers = 0 OR excl_prev_teachers IS NULL) ORDER BY start_time DESC, id DESC LIMIT 1',
    [schedule.id]
  );
  if (lastSlot) {
    const duties = await db.all('SELECT * FROM duties WHERE time_slot_id = ? ORDER BY id', [lastSlot.id]);
    for (const duty of duties) {
      if (locked) {
        const teacherName = CLASS_TEACHERS[duty.name];
        if (!teacherName) continue;
        const teacher = await db.get('SELECT id FROM teachers WHERE name = ?', [teacherName]);
        if (!teacher) continue;
        await db.run('UPDATE assignments SET teacher_id = ?, locked = 1 WHERE duty_id = ? AND slot_index = 0', [
          teacher.id,
          duty.id,
        ]);
      } else {
        await db.run('UPDATE assignments SET locked = 0 WHERE duty_id = ?', [duty.id]);
      }
    }
  }

  res.json(await getScheduleDetail(schedule.id));
}));

app.delete('/api/schedules/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

app.post('/api/schedules/:id/duplicate', wrap(async (req, res) => {
  const src = await db.get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
  if (!src) return res.status(404).json({ error: '找不到表格' });

  const name = (req.body.name || src.name).trim();
  const date = req.body.date !== undefined ? req.body.date : src.date;
  const newId = (
    await db.run('INSERT INTO schedules (name, date, lock_last_slot) VALUES (?, ?, ?)', [
      name,
      date,
      src.lock_last_slot,
    ])
  ).lastInsertRowid;

  const slots = await db.all('SELECT * FROM time_slots WHERE schedule_id = ? ORDER BY start_time, id', [src.id]);
  for (const slot of slots) {
    const newSlotId = (
      await db.run(
        'INSERT INTO time_slots (schedule_id, label, start_time, end_time, sort_order, chain_source_label, excl_prev_teachers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [newId, slot.label, slot.start_time, slot.end_time, slot.sort_order || 0, slot.chain_source_label || null, slot.excl_prev_teachers || 0]
      )
    ).lastInsertRowid;

    const duties = await db.all('SELECT * FROM duties WHERE time_slot_id = ? ORDER BY id', [slot.id]);
    for (const duty of duties) {
      const newDutyId = (
        await db.run('INSERT INTO duties (time_slot_id, name, needed_count) VALUES (?, ?, ?)', [
          newSlotId,
          duty.name,
          duty.needed_count,
        ])
      ).lastInsertRowid;
      await syncDutySeats(newDutyId, duty.needed_count);

      const lockedAssignments = await db.all(
        'SELECT slot_index, teacher_id FROM assignments WHERE duty_id = ? AND locked = 1',
        [duty.id]
      );
      for (const a of lockedAssignments) {
        await db.run('UPDATE assignments SET teacher_id = ?, locked = 1 WHERE duty_id = ? AND slot_index = ?', [
          a.teacher_id,
          newDutyId,
          a.slot_index,
        ]);
      }
    }

    const unavail = await db.all('SELECT teacher_id FROM unavailability WHERE time_slot_id = ?', [slot.id]);
    for (const u of unavail) {
      await db.run('INSERT OR IGNORE INTO unavailability (time_slot_id, teacher_id) VALUES (?, ?)', [
        newSlotId,
        u.teacher_id,
      ]);
    }
  }

  res.status(201).json(await getScheduleDetail(newId));
}));

// ---------- time slots ----------

app.post('/api/schedules/:id/slots', wrap(async (req, res) => {
  const schedule = await db.get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
  if (!schedule) return res.status(404).json({ error: '找不到表格' });

  const { label, start_time, end_time } = req.body;
  if (!label || !start_time || !end_time) {
    return res.status(400).json({ error: '請輸入時段名稱、開始及結束時間' });
  }
  await db.run('INSERT INTO time_slots (schedule_id, label, start_time, end_time) VALUES (?, ?, ?, ?)', [
    req.params.id,
    label,
    start_time,
    end_time,
  ]);
  res.status(201).json(await getScheduleDetail(req.params.id));
}));

app.put('/api/slots/:id', wrap(async (req, res) => {
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [req.params.id]);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  const label = req.body.label !== undefined ? req.body.label : slot.label;
  const start_time = req.body.start_time !== undefined ? req.body.start_time : slot.start_time;
  const end_time = req.body.end_time !== undefined ? req.body.end_time : slot.end_time;
  await db.run('UPDATE time_slots SET label = ?, start_time = ?, end_time = ? WHERE id = ?', [
    label,
    start_time,
    end_time,
    req.params.id,
  ]);
  res.json(await getScheduleDetail(slot.schedule_id));
}));

app.delete('/api/slots/:id', wrap(async (req, res) => {
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [req.params.id]);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  await db.run('DELETE FROM time_slots WHERE id = ?', [req.params.id]);
  res.json(await getScheduleDetail(slot.schedule_id));
}));

// ---------- duties ----------

app.post('/api/slots/:id/duties', wrap(async (req, res) => {
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [req.params.id]);
  if (!slot) return res.status(404).json({ error: '找不到時段' });

  const name = (req.body.name || '').trim();
  const needed_count = Math.max(1, parseInt(req.body.needed_count, 10) || 1);
  if (!name) return res.status(400).json({ error: '請輸入職務名稱' });

  const r = await db.run('INSERT INTO duties (time_slot_id, name, needed_count) VALUES (?, ?, ?)', [
    slot.id,
    name,
    needed_count,
  ]);
  await syncDutySeats(r.lastInsertRowid, needed_count);

  res.status(201).json(await getScheduleDetail(slot.schedule_id));
}));

app.put('/api/duties/:id', wrap(async (req, res) => {
  const duty = await db.get('SELECT * FROM duties WHERE id = ?', [req.params.id]);
  if (!duty) return res.status(404).json({ error: '找不到職務' });
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [duty.time_slot_id]);

  const name = req.body.name !== undefined ? String(req.body.name).trim() : duty.name;
  const needed_count =
    req.body.needed_count !== undefined ? Math.max(1, parseInt(req.body.needed_count, 10) || 1) : duty.needed_count;
  if (!name) return res.status(400).json({ error: '請輸入職務名稱' });

  await db.run('UPDATE duties SET name = ?, needed_count = ? WHERE id = ?', [name, needed_count, duty.id]);
  await syncDutySeats(duty.id, needed_count);

  res.json(await getScheduleDetail(slot.schedule_id));
}));

app.delete('/api/duties/:id', wrap(async (req, res) => {
  const duty = await db.get('SELECT * FROM duties WHERE id = ?', [req.params.id]);
  if (!duty) return res.status(404).json({ error: '找不到職務' });
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [duty.time_slot_id]);
  await db.run('DELETE FROM duties WHERE id = ?', [duty.id]);
  res.json(await getScheduleDetail(slot.schedule_id));
}));

// ---------- unavailability ----------

app.post('/api/slots/:id/unavailable', wrap(async (req, res) => {
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [req.params.id]);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  const teacherId = parseInt(req.body.teacher_id, 10);
  if (!teacherId) return res.status(400).json({ error: '請選擇老師' });
  await db.run('INSERT OR IGNORE INTO unavailability (time_slot_id, teacher_id) VALUES (?, ?)', [slot.id, teacherId]);
  res.json(await getScheduleDetail(slot.schedule_id));
}));

app.delete('/api/slots/:id/unavailable/:teacherId', wrap(async (req, res) => {
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [req.params.id]);
  if (!slot) return res.status(404).json({ error: '找不到時段' });
  await db.run('DELETE FROM unavailability WHERE time_slot_id = ? AND teacher_id = ?', [slot.id, req.params.teacherId]);
  res.json(await getScheduleDetail(slot.schedule_id));
}));

// ---------- generate / assignments ----------

app.post('/api/schedules/:id/generate', wrap(async (req, res) => {
  const detail = await getScheduleDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '找不到表格' });

  const teachers = await db.all('SELECT id, name FROM teachers WHERE active = 1 ORDER BY sort_order, id');
  if (teachers.length === 0) {
    return res.status(400).json({ error: '請先新增啟用中的老師' });
  }

  const slotsForAlgo = detail.timeSlots.map((slot) => ({
    id: slot.id,
    label: slot.label,
    start_time: slot.start_time,
    end_time: slot.end_time,
    chainFromLabel: slot.chain_source_label || null,
    hardExclPrevTeachers: !!slot.excl_prev_teachers,
    duties: slot.duties.map((d) => ({
      id: d.id,
      name: d.name,
      needed_count: d.needed_count,
      lockedSeats: new Map(
        d.assignments.filter((a) => a.locked && a.teacher_id != null).map((a) => [a.slot_index, a.teacher_id])
      ),
    })),
    unavailable: new Set(slot.unavailable.map((u) => u.teacher_id)),
  }));

  const classTeacherMap = new Map();
  for (const [dutyName, teacherName] of Object.entries(CLASS_TEACHERS)) {
    const t = teachers.find((t) => t.name === teacherName);
    if (t) classTeacherMap.set(dutyName, t.id);
  }

  const results = generateAssignments(teachers, slotsForAlgo, { classTeacherMap });

  for (const r of results) {
    await db.run('UPDATE assignments SET teacher_id = ? WHERE duty_id = ? AND slot_index = ?', [
      r.teacher_id,
      r.duty_id,
      r.slot_index,
    ]);
  }

  res.json(await getScheduleDetail(req.params.id));
}));

app.put('/api/assignments/:id', wrap(async (req, res) => {
  const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
  if (!assignment) return res.status(404).json({ error: '找不到分配紀錄' });

  const teacherId = req.body.teacher_id === null || req.body.teacher_id === '' ? null : parseInt(req.body.teacher_id, 10);
  await db.run('UPDATE assignments SET teacher_id = ? WHERE id = ?', [teacherId, assignment.id]);

  const duty = await db.get('SELECT * FROM duties WHERE id = ?', [assignment.duty_id]);
  const slot = await db.get('SELECT * FROM time_slots WHERE id = ?', [duty.time_slot_id]);
  res.json(await getScheduleDetail(slot.schedule_id));
}));

// ---------- summary ----------

app.get('/api/schedules/:id/summary', wrap(async (req, res) => {
  const detail = await getScheduleDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '找不到表格' });

  const teachers = await db.all('SELECT id, name, active FROM teachers ORDER BY sort_order, id');
  const totals = new Map(
    teachers.map((t) => [t.id, { teacher_id: t.id, name: t.name, active: t.active, total_minutes: 0, total_count: 0 }])
  );

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
}));

// ---------- export ----------

app.get('/api/schedules/:id/export.docx', wrap(async (req, res) => {
  const detail = await getScheduleDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '找不到表格' });

  const teachers = await db.all('SELECT * FROM teachers ORDER BY sort_order, id');
  const doc = buildScheduleDocument({ schedule: detail.schedule, timeSlots: detail.timeSlots, teachers });
  const buffer = await Packer.toBuffer(doc);

  const safeName = (detail.schedule.name || 'schedule').replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="schedule.docx"; filename*=UTF-8''${encodeURIComponent(safeName)}.docx`
  );
  res.send(buffer);
}));

// ---------- error handling ----------

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '伺服器錯誤' });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

db.ready
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Timearrang server running on http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('資料庫初始化失敗:', err);
    process.exit(1);
  });
