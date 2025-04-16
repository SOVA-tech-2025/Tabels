// Добавили логирование действий пользователя

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

// Конфигурация
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const TABEL_SHEET_ID = '1ed5l9Z1kJyQlGR5JdOhbicrYZREu77KJTAacRqzvkJ8'; // Табель
const ACCESS_SHEET_ID = '1jMuUhA5jmlPDJyRXcgfmOHYU4lIcuIDl0Xd_VPBOsJs'; // Доступы
const ACCESS_SHEET_NAME = 'ПРАВА ДОСТУПА';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const sheets = google.sheets({ version: 'v4', auth: GOOGLE_API_KEY });

// Проверка доступа
async function checkUserAccess(userId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: ACCESS_SHEET_ID,
      range: `${ACCESS_SHEET_NAME}!A:ZZ`,
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return false;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowUserId = row[0]?.toString().trim();

      if (rowUserId === userId.toString()) {
        const bakeries = row.slice(3)
          .filter(x => x && x.trim().length > 0);
        return bakeries;
      }
    }

    return false;
  } catch (err) {
    console.error('[ERROR] Ошибка при проверке доступа:', err.message);
    return false;
  }
}

// Получение отчета
async function getBakeryReport(sheetName, day) {
  try {
    const range = `${sheetName}!A3:AG13`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: TABEL_SHEET_ID,
      range,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return null;

    const columnIndex = 1 + parseInt(day); // 1–31 → 2–32

    const now = new Date();
    const monthNames = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    const currentMonth = monthNames[now.getMonth()];

    let report = `*${sheetName.toUpperCase()}*\n${day} ${currentMonth}:\n\n`;

    for (let i = 0; i < rows.length; i += 2) {
      const planRow = rows[i];
      const factRow = rows[i + 1];

      if (!planRow || !factRow ||
          planRow[0]?.trim() !== 'план' ||
          factRow[0]?.trim() !== 'факт') continue;

      const position = planRow[1]?.trim() || 'Неизвестная должность';
      const planValue = parseFloat(planRow[columnIndex]) || 0;
      const factValue = parseFloat(factRow[columnIndex]) || 0;
      const diff = factValue - planValue;

      let emoji = '';
      if (diff >= 1) emoji = '🔴';
      else if (diff < -5) emoji = '🟠';
      else if (diff >= 0 && diff <= 1) emoji = '🟢';

      report += `*${position}*\n` +
                `пл ${planValue.toFixed(1)} | факт ${factValue.toFixed(1)} | откл: ${diff.toFixed(1)} ${emoji}\n`;
    }

    return report;
  } catch (err) {
    console.error(`[ERROR] Ошибка при получении данных по ${sheetName}:`, err.message);
    return null;
  }
}


// /start
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
  console.log(`[LOG] Пользователь ${name} (ID: ${userId}) отправил /start`);
  
  bot.sendMessage(msg.chat.id, 'Привет! Для получения отчета используйте /report');
});

// /report
bot.onText(/\/report/, async (msg) => {
  const userId = msg.from.id;
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
  console.log(`[LOG] Пользователь ${name} (ID: ${userId}) отправил /report`);

  const bakeries = await checkUserAccess(userId);
  if (!bakeries) {
    console.log(`[LOG] ❌ Пользователь ${userId} не найден в таблице доступа`);
    return bot.sendMessage(msg.chat.id, '❌ Ваш аккаунт не найден в системе');
  }

  if (bakeries.length === 0) {
    console.log(`[LOG] ⛔ У пользователя ${userId} нет доступных точек`);
    return bot.sendMessage(msg.chat.id, '❌ У вас нет доступа к ни одной точке');
  }

  console.log(`[LOG] ✅ Пользователю ${userId} доступны точки: ${bakeries.join(', ')}`);
  bot.sendMessage(msg.chat.id, 'Введите число месяца (1-31):');
});

// Обработка даты
bot.on('message', async (msg) => {
  if (!/^\d{1,2}$/.test(msg.text)) return;

  const day = parseInt(msg.text);
  const userId = msg.from.id;
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();

  if (day < 1 || day > 31) {
    console.log(`[LOG] ❗ Пользователь ${userId} ввел некорректную дату: ${msg.text}`);
    return bot.sendMessage(msg.chat.id, '❌ Введите корректное число от 1 до 31');
  }

  console.log(`[LOG] 📅 Пользователь ${name} (ID: ${userId}) запросил отчет за ${day} число`);

  const bakeries = await checkUserAccess(userId);
  if (!bakeries || bakeries.length === 0) {
    console.log(`[LOG] ❌ Пользователь ${userId} не имеет доступа к точкам`);
    return bot.sendMessage(msg.chat.id, '❌ У вас нет доступа к данным');
  }

  let found = false;
  for (const bakery of bakeries) {
    console.log(`[LOG] 🔍 Получаем отчет для ${bakery}, день ${day}`);
    const report = await getBakeryReport(bakery, day);

    if (report) {
      console.log(`[LOG] ✅ Отчет найден для ${bakery}, отправляем пользователю ${userId}`);
      await bot.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
      found = true;
      await new Promise(res => setTimeout(res, 300));
    } else {
      console.log(`[LOG] ⚠️ Нет данных для ${bakery} за ${day}`);
    }
  }

  if (!found) {
    console.log(`[LOG] ❌ Ничего не найдено, отправляем уведомление`);
    bot.sendMessage(msg.chat.id, '❌ Нет данных за выбранную дату');
  }
});

// Проверка доступа к таблицам при запуске
async function testTablesAccess() {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: ACCESS_SHEET_ID,
      range: `${ACCESS_SHEET_NAME}!A1`,
    });

    console.log('[INIT] Проверка доступа пройдена');
  } catch (err) {
    console.error('[ERROR] Ошибка доступа к таблицам:', err.message);
    process.exit(1);
  }
}

testTablesAccess().then(() => {
  console.log('[INIT] Бот запущен');
  if (process.env.ADMIN_CHAT_ID) {
    bot.sendMessage(process.env.ADMIN_CHAT_ID, '✅ Бот запущен');
  }
});
