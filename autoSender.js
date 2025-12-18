// autoSend.js
require('dotenv').config();
const { pool } = require('./db'); // <- Assure-toi que le chemin est correct
const bot = require('./bot');

/* ================= 🎬 FILMS ================= */

async function getFilmChannels() {
  const res = await pool.query(
    'SELECT channel_id FROM channels_films WHERE active = true'
  );
  return res.rows.map(r => r.channel_id);
}

async function sendFilmToChannels(row) {
  const channels = await getFilmChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
      }

      if (row.type === 'video') {
        const { data } = await supabase.storage
          .from('media')
          .createSignedUrl(row.file_path, 300);

        await bot.sendVideo(channelId, data.signedUrl, {
          caption: row.caption || '',
          supports_streaming: true
        });
      }

      console.log(`🎬 Film envoyé → ${channelId}`);
    } catch (err) {
      console.error(`❌ Film error (${channelId})`, err.message);
    }
  }

  await pool.query(
    'UPDATE scheduled_films SET sent = true WHERE id = $1',
    [row.id]
  );
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

/* ================= 📚 MANGAS ================= */

async function getMangaChannels() {
  const res = await pool.query(
    'SELECT channel_id FROM channels_mangas WHERE active = true'
  );
  return res.rows.map(r => r.channel_id);
}

async function sendMangaToChannels(row) {
  const channels = await getMangaChannels();
  if (!channels.length) return;

  for (const channelId of channels) {
    try {
      if (row.type === 'text') {
        await bot.sendMessage(channelId, row.content);
      }

      if (row.type === 'photo' || row.type === 'video') {
        const { data } = await supabase.storage
          .from('media')
          .createSignedUrl(row.file_path, 300);

        if (row.type === 'photo') {
          await bot.sendPhoto(channelId, data.signedUrl, {
            caption: row.caption || ''
          });
        }

        if (row.type === 'video') {
          await bot.sendVideo(channelId, data.signedUrl, {
            caption: row.caption || ''
          });
        }
      }

      console.log(`📚 Manga envoyé → ${channelId}`);
    } catch (err) {
      console.error(`❌ Manga error (${channelId})`, err.message);
    }
  }

  await pool.query(
    'UPDATE scheduled_mangas SET sent = true WHERE id = $1',
    [row.id]
  );
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

/* ================= ⏰ LOOP GLOBAL ================= */

setInterval(async () => {
  try {
    await autoSendFilms();
    await autoSendMangas();
  } catch (err) {
    console.error('❌ AutoSender global error:', err.message);
  }
}, 30 * 1000);

console.log('🤖 AutoSender lancé (Films + Mangas dynamiques)');
