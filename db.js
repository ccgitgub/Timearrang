// 資料庫連線：使用 PostgreSQL。預設讀取 Railway PostgreSQL plugin 提供的
// DATABASE_URL（或 PG* 個別變數）；本機開發如未設定，則使用本機 PostgreSQL 的預設連線。
function buildPostgresUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.DATABASE_PUBLIC_URL) return process.env.DATABASE_PUBLIC_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;

  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (PGHOST && PGDATABASE) {
    const auth = `${encodeURIComponent(PGUSER || 'postgres')}:${encodeURIComponent(PGPASSWORD || '')}`;
    const port = PGPORT || 5432;
    return `postgresql://${auth}@${PGHOST}:${port}/${PGDATABASE}`;
  }

  // 本機開發預設值：假設本機有一個帳號密碼皆為 postgres 的 PostgreSQL，資料庫名稱為 timearrang
  return 'postgresql://postgres:postgres@localhost:5432/timearrang';
}

module.exports = require('./lib/db/postgres')(buildPostgresUrl());
