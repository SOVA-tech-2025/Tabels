// версия v2 с форматированием по условиям шаблона

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const TABEL_SHEET_ID = '1ed5l9Z1kJyQlGR5JdOhbicrYZREu77KJTAacRqzvkJ8';
const ACCESS_SHEET_ID = '1edfD6XdgPqxxLTBRRXrBWcbmPZeRQB7CDaLvk3vPrww';
const ACCESS_SHEET_NAME = 'ПРАВА ДОСТУПА';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const sheets = google.sheets({ version: 'v4', auth: GOOGLE_API_KEY });

const userState = {};

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
    const monthNames = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    const currentMonth = monthNames[now.getMonth()];

    let report = `*${sheetName.toUpperCase()}*\n${day} ${currentMonth} (план/факт/отклонение)\n`;

    for (let i = 0; i < rows.length; i += 2) {
      const planRow = rows[i];
      const factRow = rows[i + 1];

      if (!planRow || !factRow || planRow[0]?.trim() !== 'план' || factRow[0]?.trim() !== 'факт') continue;

      const position = planRow[1]?.trim() || 'Неизвестная должность';
      const plan = parseFloat(planRow[columnIndex]) || 0;
      const fact = parseFloat(factRow[columnIndex]) || 0;

      let line = '';
      if (fact === 0) {
        line = `${position}: ${plan}/${fact}/‼️нет данных‼️`;
      } else {
        const deviation = +(fact - plan).toFixed(2);
        let emoji = '🟢';
        if (deviation > 1) emoji = '🔺';
        else if (deviation < -5) emoji = '🔻';
        line = `${position}: ${plan}/${fact}/${Math.abs(deviation)}${emoji}`;
      }

      report += `${line}\n`;
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
  const bakeries = await checkUserAccess(userId);

  if (!bakeries) {
    return bot.sendMessage(msg.chat.id, '❌ Ваш аккаунт не найден в системе');
  }

  const keyboard = bakeries.map(b => ([{ text: b }]));
  keyboard.push([{ text: '📊 Все объекты' }]);

  userState[userId] = { step: 'selectBakery', bakeries };

  bot.sendMessage(msg.chat.id, 'Выберите объект:', {
    reply_markup: {
      keyboard: [...keyboard, [{ text: '🔙 Назад' }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    }
  });
});

bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const state = userState[userId];

  if (!state) return;

  if (msg.text === '🔙 Назад') {
    delete userState[userId];
    return bot.sendMessage(msg.chat.id, 'Выбор отменён. Введите команду /report для начала.');
  }

  if (state.step === 'selectBakery') {
    const selected = msg.text;

    if (!state.bakeries.includes(selected) && selected !== '📊 Все объекты') {
      return bot.sendMessage(msg.chat.id, 'Пожалуйста, выберите объект из списка.');
    }

    userState[userId].selectedBakery = selected;
    userState[userId].step = 'selectDay';

    const days = Array.from({ length: 31 }, (_, i) => ({ text: `${i + 1}` }));
    const keyboard = [];
    while (days.length) keyboard.push(days.splice(0, 7));
    keyboard.push([{ text: '🔙 Назад' }]);

    return bot.sendMessage(msg.chat.id, 'Выберите день месяца:', {
      reply_markup: {
        keyboard,
        one_time_keyboard: true,
        resize_keyboard: true,
      }
    });
  }

  if (state.step === 'selectDay') {
    const day = parseInt(msg.text);
    if (isNaN(day) || day < 1 || day > 31) {
      return bot.sendMessage(msg.chat.id, '❌ Введите корректное число от 1 до 31');
    }

    const bakeries = state.selectedBakery === '📊 Все объекты' ? state.bakeries : [state.selectedBakery];

    let found = false;
    for (const bakery of bakeries) {
      const report = await getBakeryReport(bakery, day);
      if (report) {
        await bot.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
        found = true;
        await new Promise(res => setTimeout(res, 300));
      }
    }

    if (!found) {
      await bot.sendMessage(msg.chat.id, '❌ Нет данных за выбранную дату');
    }

    delete userState[userId];
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
