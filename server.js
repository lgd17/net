require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");


// ====== CONFIGURATION ENV ======
const PORT = process.env.PORT || 3000; // Render fournit le PORT automatiquement
const token = process.env.TELEGRAM_TOKEN;
if (!token) throw new Error("❌ TELEGRAM_TOKEN non défini !");
const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error("❌ BASE_URL manquant dans .env !");

const encodedToken = encodeURIComponent(token);

// ====== EXPRESS ======
const app = express();
app.use(bodyParser.json());

// ====== INITIALISATION DU BOT TELEGRAM ======
const bot = new TelegramBot(token, { webHook: true });
bot.setWebHook(`${baseUrl}/bot${encodedToken}`)
  .then(() => console.log(`✅ Webhook configuré : ${baseUrl}/bot${encodedToken}`))
  .catch(err => console.error("❌ Erreur lors du setWebhook :", err));

// ====== ROUTES ======
app.post(`/bot${encodedToken}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/ping", (req, res) => res.status(200).send("✅ Bot is awake!"));

app.get("/", (req, res) => res.send("✅ Bot Telegram en ligne"));

// Routes Cron
app.get("/cron-task/manual-coupon", async (req, res) => {
  try {
    await sendManualCoupon();
    await cleanOldData();
    res.send("✅ Coupons manuels envoyés et nettoyage effectué");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Erreur manuel coupon / nettoyage");
  }
});

app.get("/cron-task/api-coupon", async (req, res) => {
  try {
    await generateAndSendCoupon();
    res.send("✅ Coupons API envoyés");
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Erreur génération coupons API");
  }
});

// ====== LANCEMENT SERVEUR ======
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});

// ====== EXPORTS ======
module.exports = { app, bot };
