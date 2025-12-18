require('dotenv').config();
const { Pool } = require('pg');
const bot = require('./bot');

const CANAL_ID = process.env.CANAL_ID;

// 📤 Envoi du contenu
async function sendContent(row) {
  try {
    if (row.type === 'text') {
      await bot.sendMessage(CANAL_ID, row.content, {
        parse_mode: 'HTML'
      });
    }

    if (row.type === 'photo' || row.type === 'video') {
      const { data, error } = await supabase.storage
        .from('media')
        .createSignedUrl(row.file_path, 300);

      if (error) throw error;

      if (row.type === 'photo') {
        await bot.sendPhoto(CANAL_ID, data.signedUrl, {
          caption: row.caption || ''
        });
      }

      if (row.type === 'video') {
        await bot.sendVideo(CANAL_ID, data.signedUrl, {
          caption: row.caption || '',
          supports_streaming: true
        });
      }
    }

    // ✅ Marquer comme envoyé
    await pool.query(
      'UPDATE scheduled_messages SET sent = true WHERE id = $1',
      [row.id]
    );

    console.log(`✅ Envoyé: ${row.type} (ID ${row.id})`);
  } catch (err) {
    console.error(`❌ Erreur ID ${row.id}:`, err.message);
  }
}

// ⏰ Vérification toutes les 30 secondes
async function autoSend() {
  try {
    const res = await pool.query(
      `SELECT * FROM scheduled_messages
       WHERE sent = false AND scheduled_at <= now()
       ORDER BY scheduled_at ASC`
    );

    for (const row of res.rows) {
      await sendContent(row);
    }
  } catch (err) {
    console.error('❌ autoSend error:', err.message);
  }
}

setInterval(autoSend, 30 * 1000);

console.log('🤖 AutoSender lancé pour un seul canal');
