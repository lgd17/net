require('dotenv').config(); // Charger les variables .env
const { Pool } = require('pg');

// ✅ Création du pool PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Gestion des erreurs côté base
pool.on('error', (err) => {
  console.error('❌ Erreur inattendue côté PostgreSQL :', err);
  process.exit(-1);
});

// ✅ Export unique
module.exports = {
  pool
};
