const schedule = require('node-schedule');
require("./pingCron");
require("./autoSender");
const { app, bot } = require("./server");
const { ping } = require("./pingServer");
const dayjs = require('dayjs');
const customParse = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParse);



// ====== CONFIGURATION ENV ======
const PORT = process.env.PORT || 3000;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const sessions = {}



/* ================= /addmangachannel ================= */



// ---------- UTILITAIRES ----------
function getSummary(session) {
  return `
📋 Récapitulatif :
Type : ${session.target.toUpperCase()}
Date : ${session.date}
Heure : ${session.time}
Contenu : ${session.type.toUpperCase()}
${session.type === 'text' ? `Texte : ${session.content}` : `Fichier : ${session.file_id || 'Pas de fichier'}`}
Caption : ${session.caption || 'Aucune'}
`;
}

async function showSummary(session, chatId) {
  const summary = getSummary(session);
  bot.sendMessage(chatId, summary, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Enregistrer', callback_data: 'summary_save' },
          { text: '❌ Annuler', callback_data: 'summary_cancel' }
        ]
      ]
    }
  });
  session.step = 'summary';
}

// ---------- START WIZARD ----------
bot.onText(/\/schedule/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  sessions[msg.chat.id] = { step: 1 };
  bot.sendMessage(msg.chat.id, 'Que veux-tu programmer ?', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎬 Film', callback_data: 'target_film' }],
        [{ text: '📚 Manga', callback_data: 'target_manga' }]
      ]
    }
  });
});

// ---------- HANDLE INLINE BUTTONS ----------
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const session = sessions[chatId];
  if (!session) return bot.answerCallbackQuery(callbackQuery.id);

  // STEP 1 : Film / Manga
  if (session.step === 1 && data.startsWith('target_')) {
    session.target = data.split('_')[1];
    session.step = 2;
    bot.sendMessage(chatId, 'Entre la date\nFormat : YYYY-MM-DD\nExemple : 2025-12-25');
    return bot.answerCallbackQuery(callbackQuery.id);
  }

  // STEP 4 : Type contenu
  if (session.step === 4 && data.startsWith('type_')) {
    const t = data.split('_')[1];
    if (t === 'skip' || t === 'text') {
      session.type = 'text';
      session.step = 5;
      bot.sendMessage(chatId, 'Entre le texte à envoyer');
    } else {
      session.type = t;
      session.step = 6;
      bot.sendMessage(chatId, 'Envoie maintenant le média');
    }
    return bot.answerCallbackQuery(callbackQuery.id);
  }

  // STEP 7 : Caption
  if (session.step === 7) {
    if (data === 'caption_skip') {
      session.caption = null;
      await showSummary(session, chatId);
      return bot.answerCallbackQuery(callbackQuery.id);
    }
    if (data === 'caption_add') {
      session.step = 8; // étape 8 = saisie texte caption
      bot.sendMessage(chatId, 'Entre le texte de la légende');
      return bot.answerCallbackQuery(callbackQuery.id);
    }
  }

  // STEP SUMMARY : Enregistrer ou Annuler
  if (session.step === 'summary') {
    if (data === 'summary_save') {
      await saveSchedule(session, chatId);
      delete sessions[chatId];
      return bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Contenu enregistré !' });
    }
    if (data === 'summary_cancel') {
      delete sessions[chatId];
      return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Contenu annulé !' });
    }
  }
});

// ---------- HANDLE TEXT / MEDIA MESSAGES ----------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (!session || (msg.text && msg.text.startsWith('/'))) return;

  const text = msg.text ? msg.text.trim() : null;

  // STEP 2 : Date
  if (session.step === 2 && text) {
    const date = dayjs(text, 'YYYY-MM-DD', true);
    if (!date.isValid()) return bot.sendMessage(chatId, '❌ Date invalide');
    session.date = text;
    session.step = 3;
    return bot.sendMessage(chatId, 'Entre l’heure\nFormat : HH:mm\nExemple : 20:30');
  }

  // STEP 3 : Heure
  if (session.step === 3 && text) {
    const time = dayjs(text, 'HH:mm', true);
    if (!time.isValid()) return bot.sendMessage(chatId, '❌ Heure invalide');
    session.time = text;
    session.step = 4;

    return bot.sendMessage(chatId, 'Quel type de contenu ?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ text', callback_data: 'type_text' }],
          [{ text: '🖼️ photo', callback_data: 'type_photo' }],
          [{ text: '🎥 video', callback_data: 'type_video' }],
          [{ text: 'Skip (texte seul)', callback_data: 'type_skip' }]
        ]
      }
    });
  }

  // STEP 5 : Texte seul
  if (session.step === 5 && text) {
    session.content = text;
    await showSummary(session, chatId);
  }

  // STEP 6 : Réception média
  if (session.step === 6) {
    if ((session.type === 'photo' && msg.photo) || (session.type === 'video' && msg.video)) {
      session.file_id = session.type === 'photo' ? msg.photo.at(-1).file_id : msg.video.file_id;
      session.step = 7;

      return bot.sendMessage(chatId, 'Ajouter une légende ?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Skip', callback_data: 'caption_skip' }],
            [{ text: 'Ajouter texte', callback_data: 'caption_add' }]
          ]
        }
      });
    }
    return bot.sendMessage(chatId, '❌ Envoie le bon média');
  }

  // STEP 8 : Saisie texte caption
  if (session.step === 8 && text) {
    session.caption = text;
    await showSummary(session, chatId);
  }
});

// ---------- SAVE FUNCTION ----------
async function saveSchedule(session, chatId) {
  const table = session.target === 'film' ? 'scheduled_films' : 'scheduled_mangas';
  const scheduledAt = dayjs(`${session.date} ${session.time}`, 'YYYY-MM-DD HH:mm').toISOString();

  await pool.query(
    `INSERT INTO ${table} (type, content, file_path, caption, scheduled_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      session.type,
      session.type === 'text' ? session.content : null,
      session.file_id || null,
      session.caption || null,
      scheduledAt
    ]
  );

  bot.sendMessage(chatId, '✅ Contenu programmé avec succès !');
  console.log(`📅 ${session.target} programmé pour ${scheduledAt}`);
}

/* ================= /addmangachannel ================= */

bot.onText(/\/addfilmchannel (.+)/, async (msg, match) => {
  const userId = msg.from.id;
  const channelId = match[1].trim();

  // 🔐 Sécurité : admin only
  if (userId !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ Commande réservée à l’admin');
  }

  // 🧪 Validation simple
  if (!channelId.startsWith('@')) {
    return bot.sendMessage(msg.chat.id, '❌ Format invalide. Exemple : /addfilmchannel @canal_films');
  }

  try {
    await pool.query(
      `INSERT INTO channels_films (channel_id)
       VALUES ($1)
       ON CONFLICT (channel_id) DO NOTHING`,
      [channelId]
    );

    await bot.sendMessage(
      msg.chat.id,
      `✅ Canal ajouté avec succès : ${channelId}`
    );

    console.log('➕ Nouveau canal FILMS:', channelId);
  } catch (err) {
    console.error('❌ addfilmchannel error:', err.message);
    bot.sendMessage(msg.chat.id, '❌ Erreur lors de l’ajout du canal');
  }
});

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

bot.onText(/\/addmangachannel (.+)/, async (msg, match) => {
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
      '❌ Format invalide.\nExemple : /addmangachannel @canal_mangas'
    );
  }

  try {
    await pool.query(
      `INSERT INTO channels_mangas (channel_id)
       VALUES ($1)
       ON CONFLICT (channel_id) DO NOTHING`,
      [channelId]
    );

    bot.sendMessage(
      msg.chat.id,
      `✅ Canal MANGAS ajouté avec succès : ${channelId}`
    );

    console.log('➕ Nouveau canal MANGAS:', channelId);
  } catch (err) {
    console.error('❌ addmangachannel error:', err.message);
    bot.sendMessage(msg.chat.id, '❌ Erreur lors de l’ajout du canal mangas');
  }
});

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
