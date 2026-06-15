const mysql = require('mysql2/promise');
const { MYSQL_SCHEMA, seed } = require('./schema');

// SQLite 寫法 "INSERT OR IGNORE INTO ..." 在 MySQL 對應為 "INSERT IGNORE INTO ..."
function translateSql(sql) {
  return sql.replace(/^\s*INSERT OR IGNORE INTO/i, 'INSERT IGNORE INTO');
}

function createMysqlDb(url) {
  const pool = mysql.createPool({
    uri: url,
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 5,
  });

  const db = {
    async get(sql, params = []) {
      const [rows] = await pool.execute(translateSql(sql), params);
      return rows[0];
    },
    async all(sql, params = []) {
      const [rows] = await pool.execute(translateSql(sql), params);
      return rows;
    },
    async run(sql, params = []) {
      const [result] = await pool.execute(translateSql(sql), params);
      return { lastInsertRowid: result.insertId, changes: result.affectedRows };
    },
  };

  db.ready = (async () => {
    for (const statement of MYSQL_SCHEMA) {
      await pool.query(statement);
    }
    await seed(db);
  })();

  return db;
}

module.exports = createMysqlDb;
