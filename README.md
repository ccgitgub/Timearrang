# Timearrang 老師值勤時間分配工具

幫助學校自動分配老師的值勤工作（操場巡查、課室巡查、TSA 監考等），
預設會盡量令每位老師的「值勤總時數」相等，亦可手動調整個別安排。

## 啟動

```bash
npm install
npm start
```

然後在瀏覽器開啟 `http://localhost:3000`。

資料會儲存在本機的 SQLite 資料庫（`data/timearrang.db`，會自動建立）。

## 使用流程

1. **老師名單**：新增所有可被分配值勤的老師。取消「在職」可在當天請假時排除該老師。
2. **值勤表**：為每一天（或每個活動）建立一張值勤表。可「複製」現有表格以重用時段及職務設定。
3. **編排 & 分配**：
   - 新增時段（例如 8:30–9:20）。
   - 為每個時段加入需要值勤的職務及所需人數（例如「操場巡查」需要 2 人）。
   - 標記該時段不可值勤的老師（例如該時段要上課）。
   - 按「平均分配 / 重新分配」，系統會自動分配，令每位老師的值勤總時數盡量相等。
   - 可在下方表格手動調整個別老師的安排，並可匯出 CSV 或列印。

## 部署到 Railway

本專案已包含 `railway.json` 及 `.nvmrc`，可直接連結 GitHub repo 到 Railway 部署：

1. 在 Railway 開新 Project → **Deploy from GitHub repo**，選擇本 repo。
2. Railway 會自動使用 Nixpacks 偵測 Node 專案，執行 `npm install` 及 `npm start`。
3. 不需要手動設定 `PORT`，伺服器會自動使用 Railway 提供的 `PORT` 環境變數。

### 資料持久化（重要）

本工具使用 SQLite 檔案 (`data/timearrang.db`) 儲存資料。Railway 的檔案系統在重新部署
（redeploy）後會重置，因此建議：

1. 在 Railway 專案中為此 service 新增一個 **Volume**。
2. 將 Volume 的 Mount path 設為 `/app/data`。
3. （可選）新增環境變數 `DATA_DIR=/app/data`，明確指定資料庫存放位置。

這樣老師名單、值勤表等資料就會在重新部署後保留。
