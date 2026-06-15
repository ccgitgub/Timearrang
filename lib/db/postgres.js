const { Pool } = require('pg');
const { POSTGRES_SCHEMA, seed } = require('./schema');

// 將 SQLite 風格的 "?" 參數佔位符轉為 PostgreSQL 的 $1, $2, ...，
// 並將 "INSERT OR IGNORE INTO ..." 轉為 PostgreSQL 的 "INSERT INTO ... ON CONFLICT DO NOTHING"
function translateSql(sql) {
  const isInsertIgnore = /^\s*INSERT OR IGNORE INTO/i.test(sql);
  let translated = sql.replace(/^(\s*)INSERT OR IGNORE INTO/i, '$1INSERT INTO');

  let n = 0;
  translated = translated.replace(/\?/g, () => `$${++n}`);

  if (isInsertIgnore) translated += ' ON CONFLICT DO NOTHING';
  return translated;
}

function createPostgresDb(url) {
  const pool = new Pool({ connectionString: url });

  const db = {
    async get(sql, params = []) {
      const result = await pool.query(translateSql(sql), params);
      return result.rows[0];
    },
    async all(sql, params = []) {
      const result = await pool.query(translateSql(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      let translated = translateSql(sql);
      if (/^\s*INSERT INTO/i.test(translated) && !/RETURNING/i.test(translated)) {
        translated += ' RETURNING id';
      }
      const result = await pool.query(translated, params);
      return {
        lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined,
        changes: result.rowCount,
      };
    },
  };

  db.ready = (async () => {
    for (const statement of POSTGRES_SCHEMA) {
      await pool.query(statement);
    }
    await seed(db);
  })();

  return db;
}

module.exports = createPostgresDb;
