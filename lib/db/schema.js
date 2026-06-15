// 資料庫結構（SQLite 與 MySQL 各自的 DDL 寫法）以及預設資料的種子邏輯，
// 由 lib/db/sqlite.js 及 lib/db/mysql.js 共用。

const SQLITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS time_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS duties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    needed_count INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS unavailability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    UNIQUE(time_slot_id, teacher_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duty_id INTEGER NOT NULL REFERENCES duties(id) ON DELETE CASCADE,
    slot_index INTEGER NOT NULL DEFAULT 0,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    UNIQUE(duty_id, slot_index)
  )`,
];

const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS teachers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    active TINYINT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    date VARCHAR(20),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS time_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_id INT NOT NULL,
    label VARCHAR(255) NOT NULL,
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS duties (
    id INT AUTO_INCREMENT PRIMARY KEY,
    time_slot_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    needed_count INT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    FOREIGN KEY (time_slot_id) REFERENCES time_slots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS unavailability (
    id INT AUTO_INCREMENT PRIMARY KEY,
    time_slot_id INT NOT NULL,
    teacher_id INT NOT NULL,
    UNIQUE KEY uniq_slot_teacher (time_slot_id, teacher_id),
    FOREIGN KEY (time_slot_id) REFERENCES time_slots(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    duty_id INT NOT NULL,
    slot_index INT NOT NULL DEFAULT 0,
    teacher_id INT,
    UNIQUE KEY uniq_duty_slot (duty_id, slot_index),
    FOREIGN KEY (duty_id) REFERENCES duties(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
  )`,
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

    for (let s = 0; s < DEFAULT_SLOTS.length; s++) {
      const [label, start, end] = DEFAULT_SLOTS[s];
      const slotId = (
        await db.run(
          'INSERT INTO time_slots (schedule_id, label, start_time, end_time, sort_order) VALUES (?, ?, ?, ?, ?)',
          [scheduleId, label, start, end, s]
        )
      ).lastInsertRowid;

      for (let d = 0; d < DEFAULT_DUTIES.length; d++) {
        const dutyId = (
          await db.run('INSERT INTO duties (time_slot_id, name, needed_count, sort_order) VALUES (?, ?, 1, ?)', [
            slotId,
            DEFAULT_DUTIES[d],
            d,
          ])
        ).lastInsertRowid;
        await db.run('INSERT INTO assignments (duty_id, slot_index, teacher_id) VALUES (?, 0, NULL)', [dutyId]);
      }
    }
  }
}

module.exports = { SQLITE_SCHEMA, MYSQL_SCHEMA, seed };
