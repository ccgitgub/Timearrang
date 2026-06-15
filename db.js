// 資料庫連線：預設使用本機 SQLite 檔案；若設定了 Railway MySQL plugin 提供的
// 連線資訊（MYSQL_URL / DATABASE_URL，或 MYSQLHOST 等個別變數），則改用 MySQL。
function buildMysqlUrl() {
  if (process.env.MYSQL_URL) return process.env.MYSQL_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.MYSQL_PUBLIC_URL) return process.env.MYSQL_PUBLIC_URL;

  const { MYSQLHOST, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE, MYSQLPORT } = process.env;
  if (MYSQLHOST && MYSQLDATABASE) {
    const auth = `${encodeURIComponent(MYSQLUSER || 'root')}:${encodeURIComponent(MYSQLPASSWORD || '')}`;
    const port = MYSQLPORT || 3306;
    return `mysql://${auth}@${MYSQLHOST}:${port}/${MYSQLDATABASE}`;
  }

  return null;
}

const mysqlUrl = buildMysqlUrl();

module.exports = mysqlUrl ? require('./lib/db/mysql')(mysqlUrl) : require('./lib/db/sqlite')();
