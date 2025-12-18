const schedule = require('node-schedule');
require("./pingCron");
require("./autoSend");
require("./autoSender");
require('./cleanLogs');
require("./cleanOldCoupons");
const { app, bot } = require("./server");
const { ping } = require("./pingServer");

const ADMIN_ID = Number(process.env.ADMIN_ID);

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
