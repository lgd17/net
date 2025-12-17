// pingServer.js

const fetch = require("node-fetch");
const axios = require("axios");
const bot = require("./bot");

const ADMIN_ID = process.env.ADMIN_ID;

const URL = process.env.PING_URL || "https://onexboom-bot.onrender.com/ping";

// 1️⃣ Ping principal
async function ping() {
  try {
    const res = await fetch(URL);

    if (res.ok) {
      console.log(`✅ Ping réussi - Status: ${res.status}`);
      // Optionnel : notification Telegram
      // await bot.sendMessage(ADMIN_ID, `✅ Ping réussi - Status: ${res.status}`);
    } else {
      console.warn(`⚠️ Ping échoué - Status: ${res.status}`);
      if (ADMIN_ID) await bot.sendMessage(ADMIN_ID, `⚠️ Ping échoué - Status: ${res.status}`);
    }
  } catch (err) {
    console.error("❌ Erreur ping :", err.message);
    if (ADMIN_ID) await bot.sendMessage(ADMIN_ID, `❌ Erreur ping : ${err.message}`);
  }
}


module.exports = { ping };
