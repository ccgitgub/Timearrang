# Timearrang 老師值勤時間分配工具

幫助學校自動分配老師的值勤工作（操場巡查、課室巡查、TSA 監考等），
預設會盡量令每位老師的「值勤總時數」相等，並盡量避免同一位老師連續兩個
時段都要值勤（每節之間盡量有一節休息），亦可手動調整個別安排。

## 啟動

```bash
npm install
npm start
```

然後在瀏覽器開啟 `http://localhost:3000`。

預設資料會儲存在本機的 SQLite 資料庫（`data/timearrang.db`，會自動建立）。
若設定了 MySQL 連線環境變數（見下方「使用 Railway MySQL 儲存資料」），則會自動改用 MySQL。

## 使用流程

1. **老師名單**：系統首次啟動時，會自動預先載入原始活動分工表中的所有老師（共 33 位）。
   可隨時新增、編輯姓名或刪除名單上的老師；取消「在職」可在當天請假時排除該老師。
2. **值勤表**：系統首次啟動時，會自動建立一張範例值勤表，並預先載入原始活動分工表中的
   時段（第一節 08:30–09:20 至第六節 12:50–13:00）；每個時段亦已預設 16 個職務
   （1A、1B、2A、2B、3A、3B、4A、4B、4C、4D、5A、5B、5C、6A、6B、6C），各需 1 人，
   可隨時新增、修改或刪除。整張表會即時儲存，方便日後開啟繼續編輯。可直接使用此表，
   或「複製」現有表格以重用時段及職務設定，再建立新的一天。
3. **編排 & 分配**：
   - 新增時段（例如 8:30–9:20）。
   - 為每個時段加入需要值勤的職務及所需人數（例如「操場巡查」需要 2 人）。
   - 標記該時段不可值勤的老師（例如該時段要上課）。
   - 按「平均分配 / 重新分配」，系統會自動分配，令每位老師的值勤總時數盡量相等，
     並盡量令每位老師連續時段之間有一節休息。
   - 可在下方表格手動調整個別老師的安排，並可匯出 Word（.docx）、CSV 或直接列印。
     匯出的 Word 表格格式與分工表一致：以老師為列、時段為欄，每格顯示該老師
     在該時段的職務。

## 部署到 Railway

本專案已包含 `railway.json` 及 `.nvmrc`，可直接連結 GitHub repo 到 Railway 部署：

1. 在 Railway 開新 Project → **Deploy from GitHub repo**，選擇本 repo。
2. Railway 會自動使用 Nixpacks 偵測 Node 專案，執行 `npm install` 及 `npm start`。
3. 不需要手動設定 `PORT`，伺服器會自動使用 Railway 提供的 `PORT` 環境變數。

### 資料持久化（重要）

本工具預設使用 SQLite 檔案 (`data/timearrang.db`) 儲存資料。Railway 的檔案系統在重新部署
（redeploy）後會重置，因此建議二選一：

**方法一：使用 Volume（SQLite）**

1. 在 Railway 專案中為此 service 新增一個 **Volume**。
2. 將 Volume 的 Mount path 設為 `/app/data`。
3. （可選）新增環境變數 `DATA_DIR=/app/data`，明確指定資料庫存放位置。

**方法二：使用 Railway 提供的 MySQL（建議用於多人協作 / 多個 service）**

見下方「使用 Railway MySQL 儲存資料」。

這樣老師名單、值勤表等資料就會在重新部署後保留。

## 使用 Railway MySQL 儲存資料

1. 在 Railway 專案中按 **+ New** → **Database** → **Add MySQL**，建立一個 MySQL service。
2. 在本工具的 service 的 **Variables** 分頁，新增一個參照變數，把 MySQL service 提供的
   `MYSQL_URL` 加入本工具的環境變數（在 Railway 可直接以
   `${{MySQL.MYSQL_URL}}` 的方式參照另一個 service 的變數）。
3. 重新部署後，伺服器會偵測到 `MYSQL_URL`，自動建立所需的資料表（教師、值勤表、
   時段、職務等），並在資料表為空時載入預設的老師名單及範例值勤表。
4. 之後即可移除 SQLite 所用的 Volume（如有設定）。

除了 `MYSQL_URL`，亦支援以下環境變數（優先順序：`MYSQL_URL` > `DATABASE_URL` >
`MYSQL_PUBLIC_URL` > 由 `MYSQLHOST`/`MYSQLUSER`/`MYSQLPASSWORD`/`MYSQLDATABASE`/`MYSQLPORT`
組合而成的連線字串）。這些變數都是 Railway 的 MySQL plugin 會自動提供的名稱，
本機開發若沒有設定任何一個，則會自動改用 SQLite。
