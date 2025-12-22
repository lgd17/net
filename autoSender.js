// autoSend.js
require('dotenv').config();
const { pool } = require('./db');
const bot = require('./bot');
const supabase = require('./supabase');

// ================= CONFIG =================

// Si ton bucket Supabase est public, active cette option
const USE_PUBLIC_BUCKET = true;

// ================= HELPERS =================
async function getSignedUrl(filePath) {
  if (USE_PUBLIC_BUCKET) {
    const { data } = supabase.storage.from('media').getPublicUrl(filePath);
    return data?.publicUrl || null;
  } else {
    const { data, error } = await supabase.storage
      .from('media')
      .createSignedUrl(filePath, 3600);
    if (error || !data) return null;
    return data.signedUrl;
  }
}

// ================= 🎬 FILMS =================
async function getFilmChannels() {
  const res = await pool.query('SELECT channel_id FROM channels_films WHERE active = true');
  return res.rows.map(r => r.channel_id);
}

async function sendFilmToChannels(row) {
  const channels = await getFilmChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
      } else if (row.type === 'video') {
        const url = await getSignedUrl(row.file_path);
        if (!url) {
          console.error(`❌ Film error (${channelId}) : fichier non trouvé -> ${row.file_path}`);
          continue;
        }
        await bot.sendVideo(channelId, url, { caption: row.caption || '', supports_streaming: true });
      }
      console.log(`🎬 Film envoyé → ${channelId}`);
    } catch (err) {
      console.error(`❌ Film error (${channelId})`, err.message);
    }
  }

  await pool.query('UPDATE scheduled_films SET sent = true WHERE id = $1', [row.id]);
}

async function autoSendFilms() {
  const res = await pool.query(
    `SELECT * FROM scheduled_films
     WHERE sent = false AND scheduled_at <= now()
     ORDER BY scheduled_at ASC`
  );

  for (const row of res.rows) {
    await sendFilmToChannels(row);
  }
}

// ================= 📚 MANGAS =================
async function getMangaChannels() {
  const res = await pool.query('SELECT channel_id FROM channels_mangas WHERE active = true');
  return res.rows.map(r => r.channel_id);
}

async function sendMangaToChannels(row) {
  const channels = await getMangaChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
      } else if (row.type === 'photo' || row.type === 'video') {
        const url = await getSignedUrl(row.file_path);
        if (!url) {
          console.error(`❌ Manga error (${channelId}) : fichier non trouvé -> ${row.file_path}`);
          continue;
        }
        if (row.type === 'photo') await bot.sendPhoto(channelId, url, { caption: row.caption || '' });
        if (row.type === 'video') await bot.sendVideo(channelId, url, { caption: row.caption || '' });
      }
      console.log(`📚 Manga envoyé → ${channelId}`);
    } catch (err) {
      console.error(`❌ Manga error (${channelId})`, err.message);
    }
  }

  await pool.query('UPDATE scheduled_mangas SET sent = true WHERE id = $1', [row.id]);
}

async function autoSendMangas() {
  const res = await pool.query(
    `SELECT * FROM scheduled_mangas
     WHERE sent = false AND scheduled_at <= now()
     ORDER BY scheduled_at ASC`
  );

  for (const row of res.rows) {
    await sendMangaToChannels(row);
  }
}

// ================= ⏰ LOOP GLOBAL =================
setInterval(async () => {
  try {
    await autoSendFilms();
    await autoSendMangas();
  } catch (err) {
    console.error('❌ AutoSender global error:', err.message);
  }
}, 30 * 1000);

console.log('🤖 AutoSender lancé (Films + Mangas dynamiques)');
