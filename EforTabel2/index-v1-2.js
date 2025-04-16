// добавили выбор объекта пользователем

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const TABEL_SHEET_ID = '1ed5l9Z1kJyQlGR5JdOhbicrYZREu77KJTAacRqzvkJ8';
const ACCESS_SHEET_ID = '1jMuUhA5jmlPDJyRXcgfmOHYU4lIcuIDl0Xd_VPBOsJs';
const ACCESS_SHEET_NAME = 'ПРАВА ДОСТУПА';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const sheets = google.sheets({ version: 'v4', auth: GOOGLE_API_KEY });
const userSessions = {}; // Храним состояние пользователей

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
        const bakeries = row.slice(3).filter(x => x && x.trim().length > 0);
        return bakeries;
      }
    }
    return false;
  } catch (err) {
    console.error('[ERROR] Ошибка при проверке доступа:', err.message);
    return false;
  }
}

async function getBakeryReport(sheetName, day) {
  try {
    const range = `${sheetName}!A3:AG13`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: TABEL_SHEET_ID,
      range,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) return null;

    const columnIndex = 1 + parseInt(day);

    const now = new Date();
    const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const currentMonth = monthNames[now.getMonth()];

    let report = `*${sheetName.toUpperCase()}*\n${day} ${currentMonth}:\n\n`;

    for (let i = 0; i < rows.length; i += 2) {
      const planRow = rows[i];
      const factRow = rows[i + 1];

      if (!planRow || !factRow || planRow[0]?.trim() !== 'план' || factRow[0]?.trim() !== 'факт') continue;

      const position = planRow[1]?.trim() || 'Неизвестная должность';
      const planValue = parseFloat(planRow[columnIndex]) || 0;
      const factValue = parseFloat(factRow[columnIndex]) || 0;
      const diff = factValue - planValue;

      let emoji = '';
      if (diff >= 1) emoji = '🔴';
      else if (diff < -5) emoji = '🟠';
      else if (diff >= 0 && diff <= 1) emoji = '🟢';

      report += `*${position}*\nпл ${planValue.toFixed(1)} | факт ${factValue.toFixed(1)} | откл: ${diff.toFixed(1)} ${emoji}\n`;
    }

    return report;
  } catch (err) {
    console.error(`[ERROR] Ошибка при получении данных по ${sheetName}:`, err.message);
    return null;
  }
}

bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
  console.log(`[LOG] Пользователь ${name} (ID: ${userId}) отправил /start`);
  bot.sendMessage(msg.chat.id, 'Привет! Для получения отчета используйте /report');
});

bot.onText(/\/report/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
  console.log(`[LOG] Пользователь ${name} (ID: ${userId}) отправил /report`);

  const bakeries = await checkUserAccess(userId);
  if (!bakeries || bakeries.length === 0) {
    return bot.sendMessage(chatId, '❌ У вас нет доступа к данным');
  }

  userSessions[userId] = { step: 'select_bakery', bakeries };

  const keyboard = bakeries.map(name => [{ text: name }]);
  keyboard.push([{ text: '📊 Все объекты' }]);

  bot.sendMessage(chatId, 'Выберите объект:', {
    reply_markup: {
      keyboard,
      resize_keyboard: true,
      one_time_keyboard: true,
    }
  });
});

bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const session = userSessions[userId];

  if (!session) return;

  if (session.step === 'select_bakery') {
    const selected = msg.text;

    if (!session.bakeries.includes(selected) && selected !== '📊 Все объекты') {
      return bot.sendMessage(chatId, '❌ Пожалуйста, выберите объект из предложенного списка.');
    }

    session.selectedBakery = selected;
    session.step = 'select_day';

    return bot.sendMessage(chatId, 'Введите число месяца (1–31):', {
      reply_markup: {
        keyboard: [[{ text: '🔙 Назад' }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      }
    });
  }

  if (session.step === 'select_day' && msg.text === '🔙 Назад') {
    session.step = 'select_bakery';
    delete session.selectedBakery;

    const keyboard = session.bakeries.map(name => [{ text: name }]);
    keyboard.push([{ text: '📊 Все объекты' }]);

    return bot.sendMessage(chatId, 'Выберите объект:', {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        one_time_keyboard: true,
      }
    });
  }

  if (session.step === 'select_day') {
    const day = parseInt(msg.text.trim());
    if (isNaN(day) || day < 1 || day > 31) {
      return bot.sendMessage(chatId, '❌ Введите корректное число от 1 до 31 или нажмите 🔙 Назад');
    }

    const bakeriesToReport = session.selectedBakery === '📊 Все объекты'
      ? session.bakeries
      : [session.selectedBakery];

    console.log(`[LOG] 📅 Пользователь ${userId} запросил отчёт за ${day}, объекты: ${bakeriesToReport.join(', ')}`);

    let anyReport = false;
    for (const bakery of bakeriesToReport) {
      const report = await getBakeryReport(bakery, day);
      if (report) {
        await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
        anyReport = true;
        await new Promise(res => setTimeout(res, 300));
      }
    }

    if (!anyReport) {
      bot.sendMessage(chatId, '❌ Нет данных за выбранную дату');
    }

    delete userSessions[userId];
  }
});

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