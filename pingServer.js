// pingServer.js
const fetch = require("node-fetch");
const bot = require("./bot");

const ADMIN_ID = process.env.ADMIN_ID;
const URL = process.env.PING_URL || "https://botnet-58y6.onrender.com/ping";

async function ping() {
  try {
    const res = await fetch(URL, { timeout: 5000 });

    // On ne log rien, juste Telegram si admin défini et erreur
    if (!res.ok) {
      if (ADMIN_ID) {
        await bot.sendMessage(
          ADMIN_ID,
          `⚠️ Ping échoué - Status: ${res.status}`
        );
      }
    }

  } catch (err) {
    if (ADMIN_ID) {
      await bot.sendMessage(
        ADMIN_ID,
        `❌ Erreur ping : ${err.message}`
      );
    }
  }
}

module.exports = { ping };
