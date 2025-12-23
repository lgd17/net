const cron = require("node-cron");
const { pool } = require("./db");

// ⏱️ Délai : 3 jours
const DAYS_LIMIT = 3;

/**
 * 🧹 Nettoyage des contenus envoyés il y a plus de 3 jours
 * - films
 * - mangas
 */
async function cleanupOldContent() {
  console.log("🧹 Nettoyage des contenus envoyés (> 3 jours) en cours...");

  const query = `
    DELETE FROM %TABLE%
    WHERE sent = true
    AND scheduled_at < NOW() - INTERVAL '${DAYS_LIMIT} days'
    RETURNING id;
  `;

  try {
    // 🎬 Films
    const filmsResult = await pool.query(
      query.replace("%TABLE%", "scheduled_films")
    );

    filmsResult.rows.forEach(row => {
      console.log(`🎬 Film supprimé (id=${row.id})`);
    });

    // 📚 Mangas
    const mangasResult = await pool.query(
      query.replace("%TABLE%", "scheduled_mangas")
    );

    mangasResult.rows.forEach(row => {
      console.log(`📚 Manga supprimé (id=${row.id})`);
    });

    console.log("✅ Nettoyage terminé avec succès");
  } catch (err) {
    console.error("❌ Erreur nettoyage contenus :", err.message);
  }
}

module.exports = { cleanupOldContent };
