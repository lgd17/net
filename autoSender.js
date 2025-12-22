require('dotenv').config();
const { pool } = require('./db');
const bot = require('./bot');
const supabase = require('./supabase');
const axios = require('axios');

// ================= CONFIG =================
const USE_PUBLIC_BUCKET = true;

// ================= HELPERS =================

// Détecte un file_id Telegram
function isTelegramFileId(value) {
  return typeof value === 'string' && value.startsWith('BA');
}

// Récupère URL Supabase
async function getMediaUrl(filePath) {
  if (!filePath) return null;

  try {
    if (USE_PUBLIC_BUCKET) {
      const { data } = supabase.storage.from('media').getPublicUrl(filePath);
      return data?.publicUrl || null;
    }

    const { data, error } = await supabase.storage
      .from('media')
      .createSignedUrl(filePath, 3600);

    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

// Envoi vidéo par stream (corrige "wrong type of web page content")
async function sendVideoStream(channelId, url, caption) {
  const res = await axios({
    method: 'get',
    url,
    responseType: 'stream'
  });

  await bot.sendVideo(channelId, res.data, {
    caption,
    supports_streaming: true
  });
}

// Vérifie accès au canal
async function canSend(channelId) {
  try {
    await bot.getChat(channelId);
    return true;
  } catch {
    console.error(`🚫 Accès refusé au canal ${channelId}`);
    return false;
  }
}

// ================= 🎬 FILMS =================

async function getFilmChannels() {
  const res = await pool.query(
    'SELECT channel_id FROM channels_films WHERE active = true'
  );
  return res.rows.map(r => r.channel_id);
}

async function sendFilm(row) {
  const channels = await getFilmChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    if (!(await canSend(channelId))) continue;

    let success = false;

    try {
      // TEXTE
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
        success = true;
      }

      // VIDÉO
      if (row.type === 'video') {
        // 🎯 file_id Telegram
        if (isTelegramFileId(row.file_path)) {
          await bot.sendVideo(channelId, row.file_path, {
            caption: row.caption || '',
            supports_streaming: true
          });
          success = true;
        }
        // 🎯 Supabase
        else {
          const url = await getMediaUrl(row.file_path);
          if (!url) throw new Error('Fichier Supabase introuvable');
          await sendVideoStream(channelId, url, row.caption || '');
          success = true;
        }
      }

      if (success) {
        console.log(`🎬 Film envoyé → ${channelId}`);
      }

    } catch (err) {
      console.error(`❌ Film error (${channelId})`, err.message);
    }

    if (success) {
      await pool.query(
        'UPDATE scheduled_films SET sent = true WHERE id = $1',
        [row.id]
      );
    }
  }
}

async function autoSendFilms() {
  const res = await pool.query(`
    SELECT * FROM scheduled_films
    WHERE sent = false AND scheduled_at <= now()
  `);

  for (const row of res.rows) {
    await sendFilm(row);
  }
}

// ================= 📚 MANGAS =================

async function getMangaChannels() {
  const res = await pool.query(
    'SELECT channel_id FROM channels_mangas WHERE active = true'
  );
  return res.rows.map(r => r.channel_id);
}

async function sendManga(row) {
  const channels = await getMangaChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    if (!(await canSend(channelId))) continue;

    let success = false;

    try {
      // TEXTE
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
        success = true;
      }

      // PHOTO / VIDÉO
      if (row.type === 'photo' || row.type === 'video') {

        // 🎯 file_id Telegram
        if (isTelegramFileId(row.file_path)) {
          if (row.type === 'photo') {
            await bot.sendPhoto(channelId, row.file_path, {
              caption: row.caption || ''
            });
          } else {
            await bot.sendVideo(channelId, row.file_path, {
              caption: row.caption || '',
              supports_streaming: true
            });
          }
          success = true;
        }
        // 🎯 Supabase
        else {
          const url = await getMediaUrl(row.file_path);
          if (!url) throw new Error('Fichier Supabase introuvable');

          if (row.type === 'photo') {
            await bot.sendPhoto(channelId, url, {
              caption: row.caption || ''
            });
          } else {
            await sendVideoStream(channelId, url, row.caption || '');
          }
          success = true;
        }
      }

      if (success) {
        console.log(`📚 Manga envoyé → ${channelId}`);
      }

    } catch (err) {
      console.error(`❌ Manga error (${channelId})`, err.message);
    }

    if (success) {
      await pool.query(
        'UPDATE scheduled_mangas SET sent = true WHERE id = $1',
        [row.id]
      );
    }
  }
}

async function autoSendMangas() {
  const res = await pool.query(`
    SELECT * FROM scheduled_mangas
    WHERE sent = false AND scheduled_at <= now()
  `);

  for (const row of res.rows) {
    await sendManga(row);
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

console.log('🤖 AutoSender FINAL lancé (Films + Mangas)');
