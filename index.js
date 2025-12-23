const schedule = require('node-schedule');
require("./pingCron");
require("./autoSender");
const { app, bot } = require("./server");
const { ping } = require("./pingServer");
const dayjs = require('dayjs');
const customParse = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParse);
const { pool } = require('./db');
const { cleanupOldContent } = require("./cleanupOldScheduledContent");

// 🕛 Tous les jours à 00:00 (heure serveur Render = UTC)
cron.schedule("0 0 * * *", async () => {
  console.log("⏰ Cron nettoyage quotidien déclenché (00:00)");
  await cleanupOldContent();
});


// ====== CONFIGURATION ENV ======
const PORT = process.env.PORT || 3000;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const sessions = {}



/* ================= /addmangachannel ================= */


/* ---------- UTILITAIRES ---------- */
function getSummary(session) {
  return `
📋 *Récapitulatif*

🎯 Type : *${session.target.toUpperCase()}*
📅 Date : *${session.date}*
⏰ Heure : *${session.time}*
📦 Contenu : *${session.type.toUpperCase()}*

${session.type === 'text'
  ? `✏️ Texte : ${session.content}`
  : `📎 Fichier : ${session.file_id || 'Aucun'}`}

📝 Caption : ${session.caption || 'Aucune'}
`;
}

async function showSummary(session, chatId) {
  session.step = 'summary';
  await bot.sendMessage(chatId, getSummary(session), {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Enregistrer', callback_data: 'summary_save' },
          { text: '❌ Annuler', callback_data: 'summary_cancel' }
        ]
      ]
    }
  });
}

/* ---------- START WIZARD ---------- */
bot.onText(/\/schedule/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  sessions[msg.chat.id] = { step: 1 };

  bot.sendMessage(msg.chat.id, '📌 Que veux-tu programmer ?', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎬 Film', callback_data: 'target_film' }],
        [{ text: '📚 Manga', callback_data: 'target_manga' }]
      ]
    }
  });
});

/* ---------- INLINE BUTTONS ---------- */
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const session = sessions[chatId];
  if (!session) return bot.answerCallbackQuery(q.id);

  /* STEP 1 */
  if (session.step === 1 && data.startsWith('target_')) {
    session.target = data.split('_')[1];
    session.step = 2;
    await bot.sendMessage(chatId, '📅 Date ?\nFormat : YYYY-MM-DD');
    return bot.answerCallbackQuery(q.id);
  }

  /* STEP 4 */
  if (session.step === 4 && data.startsWith('type_')) {
    const type = data.split('_')[1];
    session.type = type === 'skip' ? 'text' : type;

    if (session.type === 'text') {
      session.step = 5;
      await bot.sendMessage(chatId, '✏️ Entre le texte');
    } else {
      session.step = 6;
      await bot.sendMessage(chatId, '📎 Envoie le média');
    }
    return bot.answerCallbackQuery(q.id);
  }

  /* STEP 7 */
  if (session.step === 7) {
    if (data === 'caption_skip') {
      session.caption = null;
      await showSummary(session, chatId);
    }
    if (data === 'caption_add') {
      session.step = 8;
      await bot.sendMessage(chatId, '📝 Entre la légende');
    }
    return bot.answerCallbackQuery(q.id);
  }

  /* SUMMARY */
  if (session.step === 'summary') {
    if (data === 'summary_save') {
      await saveSchedule(session, chatId);
      delete sessions[chatId];
      return bot.answerCallbackQuery(q.id, { text: '✅ Enregistré' });
    }

    if (data === 'summary_cancel') {
      delete sessions[chatId];
      return bot.answerCallbackQuery(q.id, { text: '❌ Annulé' });
    }
  }
});

/* ---------- TEXT & MEDIA ---------- */
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (!session || msg.text?.startsWith('/')) return;

  const text = msg.text?.trim();

  /* STEP 2 */
  if (session.step === 2 && text) {
    if (!dayjs(text, 'YYYY-MM-DD', true).isValid())
      return bot.sendMessage(chatId, '❌ Date invalide');

    session.date = text;
    session.step = 3;
    return bot.sendMessage(chatId, '⏰ Heure ?\nFormat : HH:mm');
  }

  /* STEP 3 */
  if (session.step === 3 && text) {
    if (!dayjs(text, 'HH:mm', true).isValid())
      return bot.sendMessage(chatId, '❌ Heure invalide');

    session.time = text;
    session.step = 4;

    return bot.sendMessage(chatId, '📦 Type de contenu ?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ Texte', callback_data: 'type_text' }],
          [{ text: '🖼️ Photo', callback_data: 'type_photo' }],
          [{ text: '🎥 Vidéo', callback_data: 'type_video' }],
          [{ text: 'Skip (texte)', callback_data: 'type_skip' }]
        ]
      }
    });
  }

  /* STEP 5 */
  if (session.step === 5 && text) {
    session.content = text;
    return showSummary(session, chatId);
  }

  /* STEP 6 */
  if (session.step === 6) {
    if (session.type === 'photo' && msg.photo) {
      session.file_id = msg.photo.at(-1).file_id;
    } else if (session.type === 'video' && msg.video) {
      session.file_id = msg.video.file_id;
    } else {
      return bot.sendMessage(chatId, '❌ Mauvais type de média');
    }

    session.step = 7;
    return bot.sendMessage(chatId, '📝 Ajouter une légende ?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Skip', callback_data: 'caption_skip' }],
          [{ text: 'Ajouter', callback_data: 'caption_add' }]
        ]
      }
    });
  }

  /* STEP 8 */
  if (session.step === 8 && text) {
    session.caption = text;
    return showSummary(session, chatId);
  }
});

/* ---------- SAVE ---------- */
async function saveSchedule(session, chatId) {
  const table = session.target === 'film'
    ? 'scheduled_films'
    : 'scheduled_mangas';

  const scheduledAt = dayjs(
    `${session.date} ${session.time}`,
    'YYYY-MM-DD HH:mm'
  ).toISOString();

  await pool.query(
    `INSERT INTO ${table}
     (type, content, file_path, caption, scheduled_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      session.type,
      session.type === 'text' ? session.content : null,
      session.file_id || null,
      session.caption || null,
      scheduledAt
    ]
  );

  bot.sendMessage(chatId, '✅ Programmation enregistrée');
  console.log(`📅 ${session.target} programmé → ${scheduledAt}`);
}


/* ================= /addmangachannel ================= */

bot.onText(
  /^\/addfilmchannel(?:@\w+)?\s+(.+)/,
  async (msg, match) => {
    const userId = msg.from.id;
    const channelId = match[1].trim();

    // 🔐 Admin only
    if (userId !== ADMIN_ID) {
      return bot.sendMessage(msg.chat.id, '⛔ Commande réservée à l’admin');
    }

    // 🧪 Validation
    if (!channelId.startsWith('@')) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ Format invalide\nExemple : /addfilmchannel @canal_films'
      );
    }

    try {
      await pool.query(
        `INSERT INTO channels_films (channel_id)
         VALUES ($1)
         ON CONFLICT DO NOTHING`,
        [channelId]
      );

      bot.sendMessage(
        msg.chat.id,
        `✅ Canal FILMS ajouté avec succès : ${channelId}`
      );
    } catch (err) {
      console.error('❌ addfilmchannel error:', err);
      bot.sendMessage(msg.chat.id, '❌ Erreur base de données');
    }
  }
);

/* ================= removefilmchannel @canal_films ================= */

bot.onText(/\/removefilmchannel (.+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  const channelId = match[1].trim();

  await pool.query(
    'UPDATE channels_films SET active = false WHERE channel_id = $1',
    [channelId]
  );

  bot.sendMessage(msg.chat.id, `🗑️ Canal désactivé : ${channelId}`);
});

/* ================= listfilmchannels ================= */

bot.onText(/\/listfilmchannels/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  const res = await pool.query(
    'SELECT channel_id FROM channels_films WHERE active = true'
  );

  if (!res.rows.length) {
    return bot.sendMessage(msg.chat.id, '📭 Aucun canal films actif');
  }

  const list = res.rows.map(r => `• ${r.channel_id}`).join('\n');
  bot.sendMessage(msg.chat.id, `🎬 Canaux FILMS actifs :\n${list}`);
});

/* ================= /addmangachannel ================= */

bot.onText(
  /^\/addmangachannel(?:@\w+)?\s+(.+)/,
  async (msg, match) => {
    const userId = msg.from.id;
    const channelId = match[1].trim();

    // 🔐 Admin only
    if (userId !== ADMIN_ID) {
      return bot.sendMessage(msg.chat.id, '⛔ Commande réservée à l’admin');
    }

    // 🧪 Validation
    if (!channelId.startsWith('@')) {
      return bot.sendMessage(
        msg.chat.id,
        '❌ Format invalide\nExemple : /addmangachannel @canal_mangas'
      );
    }

    try {
      await pool.query(
        `INSERT INTO channels_mangas (channel_id)
         VALUES ($1)
         ON CONFLICT DO NOTHING`,
        [channelId]
      );

      bot.sendMessage(
        msg.chat.id,
        `✅ Canal MANGAS ajouté avec succès : ${channelId}`
      );
    } catch (err) {
      console.error('❌ addmangachannel error:', err);
      bot.sendMessage(msg.chat.id, '❌ Erreur base de données');
    }
  }
);

/* ================= removemangachannel @canal_mangas ================= */

bot.onText(/\/removemangachannel (.+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  const channelId = match[1].trim();

  await pool.query(
    'UPDATE channels_mangas SET active = false WHERE channel_id = $1',
    [channelId]
  );

  bot.sendMessage(msg.chat.id, `🗑️ Canal MANGAS désactivé : ${channelId}`);
});

/* ================= listmangachannels ================= */

bot.onText(/\/listmangachannels/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  const res = await pool.query(
    'SELECT channel_id FROM channels_mangas WHERE active = true'
  );

  if (!res.rows.length) {
    return bot.sendMessage(msg.chat.id, '📭 Aucun canal mangas actif');
  }

  const list = res.rows.map(r => `• ${r.channel_id}`).join('\n');
  bot.sendMessage(msg.chat.id, `📚 Canaux MANGAS actifs :\n${list}`);
});
