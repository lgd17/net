const schedule = require('node-schedule');
require("./pingCron");
require("./autoSender");
const { app, bot } = require("./server");
const { ping } = require("./pingServer");
const dayjs = require('dayjs');
const axios = require("axios");
const customParse = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParse);
const { pool } = require('./db');
const cron = require("node-cron");
const { cleanupOldContent } = require("./cleanupOldScheduledContent");
const { createClient } = require("@supabase/supabase-js");

// 🕛 Tous les jours à 00:00 (heure serveur Render = UTC)
cron.schedule("0 0 * * *", async () => {
  console.log("⏰ Cron nettoyage quotidien déclenché (00:00)");
  await cleanupOldContent();
});


// ====== CONFIGURATION ENV ======
const PORT = process.env.PORT || 3000;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const sessions = {};




/* ======================================================
   🛡️ ANTI-CRASH GLOBAL
====================================================== */
process.on("unhandledRejection", (reason) => console.error("❌ UNHANDLED REJECTION:", reason));
process.on("uncaughtException", (err) => console.error("🔥 UNCAUGHT EXCEPTION:", err));

/* ======================================================
   SAFE SEND (ANTI-ERREUR TELEGRAM)
====================================================== */
async function safeSend(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error("⚠️ Telegram error:", err.message);
  }
}

/* ======================================================
   UTILITAIRES
====================================================== */
function escapeMarkdown(text = "") {
  return text
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");
}

/* ======================================================
   UTILITAIRES
====================================================== */
function getSummary(session) {
  return `
📋 *Récapitulatif*

🎯 Type : *${escapeMarkdown(session.target.toUpperCase())}*
📅 Date : *${escapeMarkdown(session.date)}*
⏰ Heure : *${escapeMarkdown(session.time)}*
📦 Contenu : *${escapeMarkdown(session.type.toUpperCase())}*

${
  session.type === "text"
    ? `✏️ Texte : ${escapeMarkdown(session.content)}`
    : `📎 Fichier : ${escapeMarkdown(session.file_url || "Aucun")}`
}

📝 Légende : ${escapeMarkdown(session.caption || "Aucune")}
`;
}


async function showSummary(session, chatId) {
  session.step = "summary";
  await safeSend(chatId, getSummary(session), {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Enregistrer", callback_data: "summary_save" }],
        [{ text: "❌ Annuler", callback_data: "summary_cancel" }]
      ]
    }
  });
}

/* ================= START ================= */
bot.onText(/\/schedule/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  sessions[msg.chat.id] = { step: 1 };

  await safeSend(msg.chat.id, "📌 Que veux-tu programmer ?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎬 Film", callback_data: "target_film" }],
        [{ text: "📚 Manga", callback_data: "target_manga" }]
      ]
    }
  });
});

/* ================= CALLBACK QUERY ================= */
bot.on("callback_query", async (q) => {
  try {
    const chatId = q.message.chat.id;
    const data = q.data;
    const session = sessions[chatId];
    await bot.answerCallbackQuery(q.id);
    if (!session) return;

    // STEP 1 : Choix target
    if (session.step === 1 && data.startsWith("target_")) {
      session.target = data.split("_")[1];
      session.step = 2;
      return safeSend(chatId, "📅 Date ?\nFormat : YYYY-MM-DD");
    }

    // STEP 4 : Type de contenu
    if (session.step === 4 && data.startsWith("type_")) {
      const type = data.split("_")[1];
      session.type = type === "skip" ? "text" : type;
      if (session.type === "text") {
        session.step = 5;
        return safeSend(chatId, "✏️ Entre le texte");
      } else {
        session.step = 6;
        return safeSend(chatId, "📎 Envoie le média (photo, vidéo ou document) ou un lien direct");
      }
    }

    // STEP 7 : Caption
    if (session.step === 7) {
      if (data === "caption_skip") {
        session.caption = null;
        return showSummary(session, chatId);
      }
      if (data === "caption_add") {
        session.step = 8;
        return safeSend(chatId, "📝 Entre la légende");
      }
    }

    // STEP SUMMARY
    if (session.step === "summary") {
      if (data === "summary_save") {
        await saveSchedule(session, chatId);
        delete sessions[chatId];
        return;
      }
      if (data === "summary_cancel") {
        delete sessions[chatId];
        return safeSend(chatId, "❌ Programmation annulée");
      }
    }
  } catch (err) {
    console.error("❌ callback_query error:", err);
  }
});

/* ================= MESSAGES ================= */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (!session || msg.text?.startsWith("/")) return;
  const text = msg.text?.trim();

  try {
    // STEP 2 : Date
    if (session.step === 2 && text) {
      if (!dayjs(text, "YYYY-MM-DD", true).isValid()) return safeSend(chatId, "❌ Date invalide");
      session.date = text;
      session.step = 3;
      return safeSend(chatId, "⏰ Heure ?\nFormat : HH:mm");
    }

    // STEP 3 : Heure
    if (session.step === 3 && text) {
      if (!dayjs(text, "HH:mm", true).isValid()) return safeSend(chatId, "❌ Heure invalide");
      session.time = text;
      session.step = 4;
      return safeSend(chatId, "📦 Type de contenu ?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✏️ Texte", callback_data: "type_text" }],
            [{ text: "🖼️ Photo", callback_data: "type_photo" }],
            [{ text: "🎥 Vidéo", callback_data: "type_video" }],
            [{ text: "📄 Document", callback_data: "type_document" }],
            [{ text: "Skip (texte)", callback_data: "type_skip" }]
          ]
        }
      });
    }

    // STEP 5 : Texte
    if (session.step === 5 && text) {
      session.content = text;
      return showSummary(session, chatId);
    }

  // STEP 6 : Média (VERSION FILE_ID)
if (session.step === 6) {
  let mediaType = null;
  let fileIdOrUrl = null;

  // 🔗 Lien direct
  if (text && text.startsWith("http")) {
    mediaType = session.type;
    fileIdOrUrl = text; // URL directe
  }

  // 🖼️ Photo
  else if (session.type === "photo" && msg.photo) {
    const fileId = msg.photo.at(-1).file_id; // prend la meilleure résolution
    mediaType = "photo";
    fileIdOrUrl = fileId; // on stocke le file_id
  }

  // 🎥 Vidéo
  else if (session.type === "video" && msg.video) {
    const fileId = msg.video.file_id;
    mediaType = "video";
    fileIdOrUrl = fileId; // on stocke le file_id
  }

  // 📄 Document
  else if (session.type === "document" && msg.document) {
    const fileId = msg.document.file_id;
    mediaType = "document";
    fileIdOrUrl = fileId; // on stocke le file_id
  }

  // ⏭️ Skip
  else if (text === "/skip") {
    mediaType = null;
    fileIdOrUrl = null;
  }

  else {
    return safeSend(chatId, "⚠️ Envoie un média valide ou un lien direct.");
  }

  // Stockage dans la session
  session.file_type = mediaType;
  session.media_url = fileIdOrUrl; // <- ici on utilise media_url pour le file_id
  session.step = 7;

  return safeSend(chatId, "📝 Ajouter une légende ?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Skip", callback_data: "caption_skip" }],
        [{ text: "Ajouter", callback_data: "caption_add" }]
      ]
    }
  });
}

    // STEP 8 : Caption
    if (session.step === 8 && text) {
      session.caption = text;
      return showSummary(session, chatId);
    }

  } catch (err) {
    console.error("❌ message handler error:", err);
  }
});

/* ================= SAVE ================= */
async function saveSchedule(session, chatId) {
  try {
    const table = session.target === "film" ? "scheduled_films" : "scheduled_mangas";
    const scheduledAt = dayjs(`${session.date} ${session.time}`, "YYYY-MM-DD HH:mm").toISOString();

   await pool.query(
  `INSERT INTO ${table}
   (type, content, media_url, caption, scheduled_at)
   VALUES ($1,$2,$3,$4,$5)`,
  [
    session.type,
    session.type === "text" ? session.content : null,
    session.file_url,
    session.caption,
    scheduledAt
  ]
);


    await safeSend(chatId, "✅ Programmation enregistrée");
    console.log(`📅 ${session.target} programmé → ${scheduledAt}`);
  } catch (err) {
    console.error("🔥 DB SAVE ERROR:", err);
    await safeSend(chatId, "❌ Erreur lors de l'enregistrement");
  }
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
