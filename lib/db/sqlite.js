const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { SQLITE_SCHEMA, seed } = require('./schema');

function createSqliteDb() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const conn = new DatabaseSync(path.join(dataDir, 'timearrang.db'));
  conn.exec('PRAGMA foreign_keys = ON');
  for (const statement of SQLITE_SCHEMA) conn.exec(statement);

  const db = {
    async get(sql, params = []) {
      return conn.prepare(sql).get(...params);
    },
    async all(sql, params = []) {
      return conn.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const r = conn.prepare(sql).run(...params);
      return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
    },
  };

  db.ready = seed(db);
  return db;
}

module.exports = createSqliteDb;
