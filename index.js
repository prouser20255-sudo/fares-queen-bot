const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// --- الإعدادات ---
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const CHANNEL_USER = "@fz_z_Z"; 
const APP_URL = "https://fares-queen-bot.onrender.com"; 

const app = express();
const bot = new TelegramBot(token, { polling: true });
const sessions = new Map();
const SESSIONS_DIR = './sessions';
fs.ensureDirSync(SESSIONS_DIR);

// إدارة الإعدادات
const getUserSettings = (chatId) => {
    const filePath = path.join(SESSIONS_DIR, String(chatId), 'settings.json');
    return fs.existsSync(filePath) ? fs.readJsonSync(filePath) : { emoji: "👑", autoViewStatus: true, autoReactStatus: true, autoReplies: [] };
};

// --- محرك الواتساب المحسن للتخفي ---
async function startBot(chatId, phone) {
    const sessionDir = path.join(SESSIONS_DIR, String(chatId));

    // تنظيف عميق للجلسة الفاشلة
    if (sessions.has(chatId)) {
        try { sessions.get(chatId).end(); } catch (e) {}
        sessions.delete(chatId);
    }
    if (fs.existsSync(sessionDir) && !fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        fs.removeSync(sessionDir);
    }
    fs.ensureDirSync(sessionDir);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        // تغيير الهوية لتبدو كجهاز أندرويد حقيقي (Android Mobile)
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        syncFullHistory: false,
        printQRInTerminal: false,
        connectTimeoutMs: 120000, // زيادة الوقت لدقيقتين
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
    });

    sessions.set(chatId, sock);

    if (!sock.authState.creds.registered) {
        // انتظار عشوائي بين 10 إلى 15 ثانية قبل طلب الكود لخداع نظام الفحص
        const randomDelay = Math.floor(Math.random() * (15000 - 10000 + 1)) + 10000;
        await delay(randomDelay);

        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ كود الربط الخاص بك هو:\n\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("Critical Error:", e);
            bot.sendMessage(chatId, "❌ السيرفر محظور حالياً من واتساب.\n\n**لحل المشكلة:**\n1. انتظر ساعة كاملة بدون محاولات.\n2. أو جرب تشغيل البوت على منصة أخرى مثل (Koyeb أو Zeabur).");
        }
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'open') bot.sendMessage(chatId, "🔓 متصل الآن!");
        if (update.connection === 'close' && update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot(chatId, phone);
    });
}

// تشغيل السيرفر
app.get('/', (req, res) => res.json({ status: "running" }));
app.listen(process.env.PORT || 10000);

// تليجرام
bot.on('message', async (msg) => {
    if (msg.text && /^[0-9]{10,}$/.test(msg.text.replace('+', ''))) {
        bot.sendMessage(msg.chat.id, "⏳ جاري محاولة تجاوز الفحص وطلب الكود...");
        startBot(msg.chat.id, msg.text.replace(/[^0-9]/g, ''));
    }
});
