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
  } catch (err) {
    console.error('❌ getMediaUrl error:', err.message);
    return null;
  }
}

// Envoi vidéo par stream ou URL directe
async function sendVideoStream(channelId, url, caption) {
  if (url.startsWith('http')) {
    // Telegram accepte URL direct
    await bot.sendVideo(channelId, url, { caption, supports_streaming: true });
    return;
  }

  // Sinon téléchargement depuis Supabase et envoi
  const res = await axios({ method: 'get', url, responseType: 'stream' });
  await bot.sendVideo(channelId, res.data, { caption, supports_streaming: true });
}

// Vérifie si le bot peut envoyer dans le canal
async function canSend(channelId) {
  try {
    await bot.getChat(channelId);
    return true;
  } catch {
    console.error(`🚫 Accès refusé au canal ${channelId}`);
    return false;
  }
}

// ================= ENVOI FILMS =================
async function getFilmChannels() {
  const res = await pool.query('SELECT channel_id FROM channels_films WHERE active = true');
  return res.rows.map(r => r.channel_id);
}

async function sendFilm(row) {
  const channels = await getFilmChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    if (!(await canSend(channelId))) continue;
    let success = false;

    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
        success = true;
      }

      if (row.type === 'photo') {
        if (isTelegramFileId(row.media_url)) {
          await bot.sendPhoto(channelId, row.media_url, { caption: row.caption || '' });
          success = true;
        } else {
          const url = await getMediaUrl(row.media_url) || row.media_url;
          await bot.sendPhoto(channelId, url, { caption: row.caption || '' });
          success = true;
        }
      }

      if (row.type === 'video') {
        if (isTelegramFileId(row.media_url)) {
          await bot.sendVideo(channelId, row.media_url, { caption: row.caption || '', supports_streaming: true });
          success = true;
        } else {
          const url = await getMediaUrl(row.media_url) || row.media_url;
          await sendVideoStream(channelId, url, row.caption || '');
          success = true;
        }
      }

      if (row.type === 'document') {
        if (isTelegramFileId(row.media_url)) {
          await bot.sendDocument(channelId, row.media_url, { caption: row.caption || '' });
          success = true;
        } else {
          const url = await getMediaUrl(row.media_url) || row.media_url;
          await bot.sendDocument(channelId, url, { caption: row.caption || '' });
          success = true;
        }
      }

      if (success) console.log(`🎬 Film envoyé → ${channelId}`);
    } catch (err) {
      console.error(`❌ Film error (${channelId})`, err.message);
    }

    if (success) {
      await pool.query('UPDATE scheduled_films SET sent = true WHERE id = $1', [row.id]);
    }
  }
}

async function autoSendFilms() {
  const res = await pool.query('SELECT * FROM scheduled_films WHERE sent = false AND scheduled_at <= now()');
  for (const row of res.rows) await sendFilm(row);
}

// ================= ENVOI MANGAS =================
async function getMangaChannels() {
  const res = await pool.query('SELECT channel_id FROM channels_mangas WHERE active = true');
  return res.rows.map(r => r.channel_id);
}

async function sendManga(row) {
  const channels = await getMangaChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    if (!(await canSend(channelId))) continue;
    let success = false;

    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
        success = true;
      }

      if (['photo','video','document'].includes(row.type)) {
        if (isTelegramFileId(row.media_url)) {
          if (row.type === 'photo') await bot.sendPhoto(channelId, row.media_url, { caption: row.caption || '' });
          if (row.type === 'video') await bot.sendVideo(channelId, row.media_url, { caption: row.caption || '', supports_streaming: true });
          if (row.type === 'document') await bot.sendDocument(channelId, row.media_url, { caption: row.caption || '' });
          success = true;
        } else {
          const url = await getMediaUrl(row.media_url) || row.media_url;
          if (row.type === 'photo') await bot.sendPhoto(channelId, url, { caption: row.caption || '' });
          if (row.type === 'video') await sendVideoStream(channelId, url, row.caption || '');
          if (row.type === 'document') await bot.sendDocument(channelId, url, { caption: row.caption || '' });
          success = true;
        }
      }

      if (success) console.log(`📚 Manga envoyé → ${channelId}`);
    } catch (err) {
      console.error(`❌ Manga error (${channelId})`, err.message);
    }

    if (success) {
      await pool.query('UPDATE scheduled_mangas SET sent = true WHERE id = $1', [row.id]);
    }
  }
}

async function autoSendMangas() {
  const res = await pool.query('SELECT * FROM scheduled_mangas WHERE sent = false AND scheduled_at <= now()');
  for (const row of res.rows) await sendManga(row);
}

// ================= LOOP GLOBAL =================
setInterval(async () => {
  try {
    await autoSendFilms();
    await autoSendMangas();
  } catch (err) {
    console.error('❌ AutoSender global error:', err.message);
  }
}, 30 * 1000);

console.log('🤖 AutoSender FINAL lancé (Films + Mangas)');
