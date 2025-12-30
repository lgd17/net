const schedule = require('node-schedule');
require("./pingCron");
require("./autoSender");
const { app, bot } = require("./server");
const { ping } = require("./pingServer");
const dayjs = require('dayjs');
const customParse = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParse);
const { pool } = require('./db');
const cron = require("node-cron");
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



/* ================= CONFIG ================= */
const dayjs = require("dayjs");
const sessions = {};
const ADMIN_ID = Number(process.env.ADMIN_ID);

/* ======================================================
   🛡️ ANTI-CRASH GLOBAL (OBLIGATOIRE)
====================================================== */
process.on("unhandledRejection", (reason) => {
  console.error("❌ UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});

/* ======================================================
   SAFE SEND (ANTI ERREUR TELEGRAM)
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
function getSummary(session) {
  return `
📋 *Récapitulatif*

🎯 Type : *${session.target.toUpperCase()}*
📅 Date : *${session.date}*
⏰ Heure : *${session.time}*
📦 Contenu : *${session.type.toUpperCase()}*

${session.type === "text"
  ? `✏️ Texte : ${session.content}`
  : `📎 Fichier : ${session.file_id || "Aucun"}`}

📝 Légende : ${session.caption || "Aucune"}
`;
}

async function showSummary(session, chatId) {
  try {
    session.step = "summary";

    await safeSend(chatId, getSummary(session), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Enregistrer", callback_data: "summary_save" },
            { text: "❌ Annuler", callback_data: "summary_cancel" }
          ]
        ]
      }
    });
  } catch (err) {
    console.error("❌ showSummary error:", err);
  }
}

/* ======================================================
   START
====================================================== */
bot.onText(/\/schedule/, async (msg) => {
  try {
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
  } catch (err) {
    console.error("❌ /schedule error:", err);
  }
});

/* ======================================================
   CALLBACK QUERY (ANTI 400 / ANTI CRASH)
====================================================== */
bot.on("callback_query", async (q) => {
  try {
    const chatId = q.message.chat.id;
    const data = q.data;
    const session = sessions[chatId];

    // ✅ TOUJOURS répondre immédiatement
    await bot.answerCallbackQuery(q.id);

    if (!session) return;

    /* STEP 1 */
    if (session.step === 1 && data.startsWith("target_")) {
      session.target = data.split("_")[1];
      session.step = 2;
      await safeSend(chatId, "📅 Date ?\nFormat : YYYY-MM-DD");
      return;
    }

    /* STEP 4 */
    if (session.step === 4 && data.startsWith("type_")) {
      const type = data.split("_")[1];
      session.type = type === "skip" ? "text" : type;

      if (session.type === "text") {
        session.step = 5;
        await safeSend(chatId, "✏️ Entre le texte");
      } else {
        session.step = 6;
        await safeSend(chatId, "📎 Envoie le média");
      }
      return;
    }

    /* STEP 7 */
    if (session.step === 7) {
      if (data === "caption_skip") {
        session.caption = null;
        await showSummary(session, chatId);
        return;
      }

      if (data === "caption_add") {
        session.step = 8;
        await safeSend(chatId, "📝 Entre la légende");
        return;
      }
    }

    /* SUMMARY */
    if (session.step === "summary") {
      if (data === "summary_save") {
        await saveSchedule(session, chatId);
        delete sessions[chatId];
        return;
      }

      if (data === "summary_cancel") {
        delete sessions[chatId];
        await safeSend(chatId, "❌ Programmation annulée");
        return;
      }
    }

  } catch (err) {
    console.error("❌ callback_query error:", err);
  }
});

/* ======================================================
   MESSAGES (ANTI CRASH)
====================================================== */
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const session = sessions[chatId];
    if (!session || msg.text?.startsWith("/")) return;

    const text = msg.text?.trim();

    /* STEP 2 */
    if (session.step === 2 && text) {
      if (!dayjs(text, "YYYY-MM-DD", true).isValid()) {
        return safeSend(chatId, "❌ Date invalide");
      }

      session.date = text;
      session.step = 3;
      return safeSend(chatId, "⏰ Heure ?\nFormat : HH:mm");
    }

    /* STEP 3 */
    if (session.step === 3 && text) {
      if (!dayjs(text, "HH:mm", true).isValid()) {
        return safeSend(chatId, "❌ Heure invalide");
      }

      session.time = text;
      session.step = 4;

      return safeSend(chatId, "📦 Type de contenu ?", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✏️ Texte", callback_data: "type_text" }],
            [{ text: "🖼️ Photo", callback_data: "type_photo" }],
            [{ text: "🎥 Vidéo", callback_data: "type_video" }],
            [{ text: "Skip (texte)", callback_data: "type_skip" }]
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
  if (session.type === "video" && msg.video) {
    const fileId = msg.video.file_id;

    // 1️⃣ Récupérer le lien du fichier depuis Telegram
    const fileLink = await bot.getFileLink(fileId);

    // 2️⃣ Télécharger le fichier en local
    const videoData = await axios.get(fileLink, { responseType: "arraybuffer" });
    const fileName = `videos/${fileId}.mp4`; // nom unique

    // 3️⃣ Upload sur Supabase
    const { data, error } = await supabase.storage
      .from("videos") // ton bucket
      .upload(fileName, videoData.data, {
        cacheControl: "3600",
        upsert: true,
        contentType: "video/mp4"
      });

    if (error) {
      return safeSend(chatId, "❌ Erreur upload Supabase: " + error.message);
    }

    // 4️⃣ Récupérer l'URL publique
    const { publicURL } = supabase.storage
      .from("videos")
      .getPublicUrl(fileName);

    session.file_url = publicURL; // <- à enregistrer en DB
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
}

    /* STEP 8 */
    if (session.step === 8 && text) {
      session.caption = text;
      return showSummary(session, chatId);
    }

  } catch (err) {
    console.error("❌ message handler error:", err);
  }
});

/* ======================================================
   SAVE (ANTI CRASH DB)
====================================================== */
async function saveSchedule(session, chatId) {
  try {
    const table =
      session.target === "film"
        ? "scheduled_films"
        : "scheduled_mangas";

    const scheduledAt = dayjs(
      `${session.date} ${session.time}`,
      "YYYY-MM-DD HH:mm"
    ).toISOString();

   await pool.query(
  `INSERT INTO ${table} (type, content, file_path, caption, scheduled_at)
   VALUES ($1,$2,$3,$4,$5)`,
  [
    session.type,
    session.type === "text" ? session.content : null,
    session.file_url || null, 
    session.caption || null,
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
