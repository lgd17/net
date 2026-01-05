const { pool } = require('./db');
const bot = require('./bot');
const supabase = require('./supabase');
const axios = require('axios');

// Détecte si c'est un file_id Telegram
function isTelegramFileId(value) {
  return typeof value === 'string' && value.startsWith('BA');
}

// Récupère URL Supabase si ce n'est pas un file_id Telegram
async function getMediaUrl(filePath) {
  if (!filePath) return null;

  if (isTelegramFileId(filePath)) return filePath; // file_id → direct

  try {
    const { data } = supabase.storage.from('media').getPublicUrl(filePath);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('❌ getMediaUrl error:', err.message);
    return null;
  }
}

// Envoi vidéo par stream
async function sendVideoStream(channelId, url, caption) {
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
async function sendFilm(row) {
  const res = await pool.query('SELECT channel_id FROM channels_films WHERE active = true');
  const channels = res.rows.map(r => r.channel_id);
  if (!channels.length) return;

  for (const channelId of channels) {
    if (!(await canSend(channelId))) continue;

    let success = false;
    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
        success = true;
      } else if (row.type === 'video') {
        const media = await getMediaUrl(row.media_url);
        if (!media) throw new Error('Fichier introuvable');

        if (isTelegramFileId(media)) {
          await bot.sendVideo(channelId, media, { caption: row.caption || '', supports_streaming: true });
        } else {
          await sendVideoStream(channelId, media, row.caption || '');
        }
        success = true;
      }
    } catch (err) {
      console.error(`❌ Film error (${channelId}):`, err.message);
    }

    if (success) {
      await pool.query('UPDATE scheduled_films SET sent = true WHERE id = $1', [row.id]);
      console.log(`🎬 Film envoyé → ${channelId}`);
    }
  }
}

// ================= ENVOI MANGAS =================
async function sendManga(row) {
  const res = await pool.query('SELECT channel_id FROM channels_mangas WHERE active = true');
  const channels = res.rows.map(r => r.channel_id);
  if (!channels.length) return;

  for (const channelId of channels) {
    if (!(await canSend(channelId))) continue;

    let success = false;
    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
        success = true;
      } else if (row.type === 'photo' || row.type === 'video') {
        const media = await getMediaUrl(row.media_url);
        if (!media) throw new Error('Fichier introuvable');

        if (row.type === 'photo') {
          if (isTelegramFileId(media)) await bot.sendPhoto(channelId, media, { caption: row.caption || '' });
          else await bot.sendPhoto(channelId, media, { caption: row.caption || '' });
        } else { // video
          if (isTelegramFileId(media)) await bot.sendVideo(channelId, media, { caption: row.caption || '', supports_streaming: true });
          else await sendVideoStream(channelId, media, row.caption || '');
        }
        success = true;
      }
    } catch (err) {
      console.error(`❌ Manga error (${channelId}):`, err.message);
    }

    if (success) {
      await pool.query('UPDATE scheduled_mangas SET sent = true WHERE id = $1', [row.id]);
      console.log(`📚 Manga envoyé → ${channelId}`);
    }
  }
}

// ================= AUTO SEND LOOP =================
async function autoSend() {
  try {
    const films = await pool.query('SELECT * FROM scheduled_films WHERE sent = false AND scheduled_at <= now()');
    for (const row of films.rows) await sendFilm(row);

    const mangas = await pool.query('SELECT * FROM scheduled_mangas WHERE sent = false AND scheduled_at <= now()');
    for (const row of mangas.rows) await sendManga(row);
  } catch (err) {
    console.error('❌ AutoSend error:', err.message);
  }
}

setInterval(autoSend, 30 * 1000);
console.log('🤖 AutoSender final lancé (Films + Mangas)');
