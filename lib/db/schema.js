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
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS time_slots (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
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
  // 為已存在的資料庫補上 locked 欄位（新資料庫由上方 CREATE TABLE 已包含此欄位，此處為 no-op）
  `ALTER TABLE assignments ADD COLUMN IF NOT EXISTS locked INTEGER NOT NULL DEFAULT 0`,
];

// 預設老師名單（取自原始活動分工表）
const DEFAULT_TEACHERS = [
  'A時', 'B東', 'C思', 'D浩', 'E緻', 'F刁', 'G謝', 'H芬', 'I珍', 'K甄',
  'L佩', 'M婉', 'N慧', 'P妍', 'Q劉', 'R珊', 'S涼', 'T毛', 'V祖', 'X樊',
  'Y曉', 'Z蘇', 'BB勤', 'DD珈', 'EE依', 'FF賢', 'GG華', 'HH兒', 'JJ瑩',
  'KK敏', 'OO萍', 'VV英', 'WW練',
];

// 預設值勤表（取自原始活動分工表的時段）
const DEFAULT_SLOTS = [
  ['第一節', '08:30', '09:20'],
  ['第二節', '09:20', '10:10'],
  ['第三節', '10:25', '11:15'],
  ['第四節', '11:15', '12:05'],
  ['第五節', '12:25', '12:50'],
  ['第六節', '12:50', '13:00'],
];

// 每節預設職務（各班巡查），預設各需 1 人
const DEFAULT_DUTIES = [
  '1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '4C', '4D',
  '5A', '5B', '5C', '6A', '6B', '6C',
];

// 各班班主任（最後一節預設固定由班主任值勤；1A/1B 有兩位班主任時僅排其中一位）
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

// 為指定的值勤表加入預設時段及每個時段的預設職務（取自原始活動分工表）。
// 最後一節（第六節）的職務會預先固定指派給對應班別的班主任（locked = 1），
// 「平均分配 / 重新分配」時不會更改這些安排，但其值勤時數仍計入總時數平衡。
async function addDefaultSlotsAndDuties(db, scheduleId) {
  for (let s = 0; s < DEFAULT_SLOTS.length; s++) {
    const [label, start, end] = DEFAULT_SLOTS[s];
    const slotId = (
      await db.run(
        'INSERT INTO time_slots (schedule_id, label, start_time, end_time, sort_order) VALUES (?, ?, ?, ?, ?)',
        [scheduleId, label, start, end, s]
      )
    ).lastInsertRowid;

    const isLastSlot = s === DEFAULT_SLOTS.length - 1;

    for (let d = 0; d < DEFAULT_DUTIES.length; d++) {
      const dutyName = DEFAULT_DUTIES[d];
      const dutyId = (
        await db.run('INSERT INTO duties (time_slot_id, name, needed_count, sort_order) VALUES (?, ?, 1, ?)', [
          slotId,
          dutyName,
          d,
        ])
      ).lastInsertRowid;

      let teacherId = null;
      let locked = 0;
      if (isLastSlot && CLASS_TEACHERS[dutyName]) {
        const teacher = await db.get('SELECT id FROM teachers WHERE name = ?', [CLASS_TEACHERS[dutyName]]);
        if (teacher) {
          teacherId = teacher.id;
          locked = 1;
        }
      }
      await db.run('INSERT INTO assignments (duty_id, slot_index, teacher_id, locked) VALUES (?, 0, ?, ?)', [
        dutyId,
        teacherId,
        locked,
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

module.exports = { POSTGRES_SCHEMA, seed, addDefaultSlotsAndDuties };
