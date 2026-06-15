const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'timearrang.db'));

db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS duties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  needed_count INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS unavailability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  UNIQUE(time_slot_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_id INTEGER NOT NULL REFERENCES duties(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL DEFAULT 0,
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  UNIQUE(duty_id, slot_index)
);
`);

// 預設老師名單（取自原始活動分工表），僅在老師名單為空時插入一次
const DEFAULT_TEACHERS = [
  'A時', 'B東', 'C思', 'D浩', 'E緻', 'F刁', 'G謝', 'H芬', 'I珍', 'K甄',
  'L佩', 'M婉', 'N慧', 'P妍', 'Q劉', 'R珊', 'S涼', 'T毛', 'V祖', 'X樊',
  'Y曉', 'Z蘇', 'BB勤', 'DD珈', 'EE依', 'FF賢', 'GG華', 'HH兒', 'JJ瑩',
  'KK敏', 'OO萍', 'VV英', 'WW練',
];

const teacherCount = db.prepare('SELECT COUNT(*) AS count FROM teachers').get().count;
if (teacherCount === 0) {
  const insertTeacher = db.prepare('INSERT INTO teachers (name, active, sort_order) VALUES (?, 1, ?)');
  DEFAULT_TEACHERS.forEach((name, index) => insertTeacher.run(name, index));
}

module.exports = db;
