// 資料庫結構（PostgreSQL DDL）以及預設資料的種子邏輯，由 lib/db/postgres.js 使用。

const POSTGRES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT,
    lock_last_slot INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS time_slots (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    chain_source_label TEXT,
    excl_prev_teachers INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS duties (
    id SERIAL PRIMARY KEY,
    time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    needed_count INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS unavailability (
    id SERIAL PRIMARY KEY,
    time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    UNIQUE(time_slot_id, teacher_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    duty_id INTEGER NOT NULL REFERENCES duties(id) ON DELETE CASCADE,
    slot_index INTEGER NOT NULL DEFAULT 0,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(duty_id, slot_index)
  )`,
  `ALTER TABLE assignments ADD COLUMN IF NOT EXISTS locked INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE schedules ADD COLUMN IF NOT EXISTS lock_last_slot INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS chain_source_label TEXT`,
  `ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS excl_prev_teachers INTEGER NOT NULL DEFAULT 0`,
];

// 預設老師名單（取自原始活動分工表）
const DEFAULT_TEACHERS = [
  'A時', 'B東', 'C思', 'D浩', 'E緻', 'F刁', 'G謝', 'H芬', 'I珍', 'K甄',
  'L佩', 'M婉', 'N慧', 'P妍', 'Q劉', 'R珊', 'S涼', 'T毛', 'V祖', 'X樊',
  'Y曉', 'Z蘇', 'BB勤', 'DD珈', 'EE依', 'FF賢', 'GG華', 'HH兒', 'JJ瑩',
  'KK敏', 'OO萍', 'VV英', 'WW練',
];

// 預設值勤表時段
// chainFrom: 此時段的值勤由指定時段（同名稱）的老師直接承擔，不重新分配
// exclPrevTeachers: true 表示上一時段的老師絕對不能在此時段值勤（硬性限制）
// lockClassTeachers: true 表示此時段的各班職務預設固定由該班班主任承擔
const DEFAULT_SLOTS = [
  { label: '第一節',    start: '08:30', end: '09:20' },
  { label: '第二節前段', start: '09:20', end: '09:45' },
  { label: '第二節後段', start: '09:45', end: '10:10' },
  { label: '小息',      start: '10:10', end: '10:25' },
  { label: '第三節',    start: '10:25', end: '11:15' },
  { label: '第四節',    start: '11:15', end: '12:05' },
  { label: '小息',      start: '12:05', end: '12:10', chainFrom: '第四節' },
  { label: '第五節',    start: '12:10', end: '13:00', lockClassTeachers: true },
  { label: '放學當值',  start: '13:00', end: '13:00', exclPrevTeachers: true },
];

// 每節預設職務（各班巡查），預設各需 1 人
const DEFAULT_DUTIES = [
  '1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '4C', '4D',
  '5A', '5B', '5C', '6A', '6B', '6C',
];

// 各班班主任（第五節預設固定由班主任值勤；1A/1B 有兩位班主任時僅排其中一位）
const CLASS_TEACHERS = {
  '1A': 'FF賢',
  '1B': 'Q劉',
  '2A': 'F刁',
  '2B': 'DD珈',
  '3A': 'I珍',
  '3B': 'X樊',
  '4A': 'HH兒',
  '4B': 'D浩',
  '4C': 'A時',
  '4D': 'EE依',
  '5A': 'B東',
  '5B': 'P妍',
  '5C': 'N慧',
  '6A': 'G謝',
  '6B': 'C思',
  '6C': 'M婉',
};

// 為指定的值勤表加入預設時段及每個時段的預設職務。
// 標有 lockClassTeachers 的時段（第五節）會預先固定指派各班班主任（locked = 1）。
// 標有 chainFrom 的時段（小息）由來源時段的老師自動承擔，不重新分配。
// 標有 exclPrevTeachers 的時段（放學當值）上一時段的老師絕對不能承擔。
async function addDefaultSlotsAndDuties(db, scheduleId) {
  for (let s = 0; s < DEFAULT_SLOTS.length; s++) {
    const slotDef = DEFAULT_SLOTS[s];
    const slotId = (
      await db.run(
        'INSERT INTO time_slots (schedule_id, label, start_time, end_time, sort_order, chain_source_label, excl_prev_teachers) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [scheduleId, slotDef.label, slotDef.start, slotDef.end, s, slotDef.chainFrom || null, slotDef.exclPrevTeachers ? 1 : 0]
      )
    ).lastInsertRowid;

    for (let d = 0; d < DEFAULT_DUTIES.length; d++) {
      const dutyName = DEFAULT_DUTIES[d];
      const dutyId = (
        await db.run('INSERT INTO duties (time_slot_id, name, needed_count, sort_order) VALUES (?, ?, 1, ?)', [
          slotId, dutyName, d,
        ])
      ).lastInsertRowid;

      let teacherId = null;
      let locked = 0;
      if (slotDef.lockClassTeachers && CLASS_TEACHERS[dutyName]) {
        const teacher = await db.get('SELECT id FROM teachers WHERE name = ?', [CLASS_TEACHERS[dutyName]]);
        if (teacher) {
          teacherId = teacher.id;
          locked = 1;
        }
      }
      await db.run('INSERT INTO assignments (duty_id, slot_index, teacher_id, locked) VALUES (?, 0, ?, ?)', [
        dutyId, teacherId, locked,
      ]);
    }
  }
}

// 預設資料種子：僅在對應的表格為空時插入，db 為統一的 async get/all/run 介面
async function seed(db) {
  const teacherCount = Number((await db.get('SELECT COUNT(*) AS count FROM teachers')).count);
  if (teacherCount === 0) {
    for (let i = 0; i < DEFAULT_TEACHERS.length; i++) {
      await db.run('INSERT INTO teachers (name, active, sort_order) VALUES (?, 1, ?)', [DEFAULT_TEACHERS[i], i]);
    }
  }

  const scheduleCount = Number((await db.get('SELECT COUNT(*) AS count FROM schedules')).count);
  if (scheduleCount === 0) {
    const scheduleId = (
      await db.run('INSERT INTO schedules (name, date) VALUES (?, ?)', ['15/6/2026(一)', '2026-06-15'])
    ).lastInsertRowid;
    await addDefaultSlotsAndDuties(db, scheduleId);
  }
}

module.exports = { POSTGRES_SCHEMA, seed, addDefaultSlotsAndDuties, CLASS_TEACHERS };
