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

// --- إعدادات البوت ---
const TELEGRAM_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const CHANNEL_USER = "@fz_z_Z"; 
const APP_URL = "https://fares-queen-bot.onrender.com"; // رابط سيرفرك

const app = express();
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const sessions = new Map();
const SESSIONS_DIR = './sessions';

fs.ensureDirSync(SESSIONS_DIR);

// --- نظام البقاء نشطاً (Anti-Sleep) ---
setInterval(() => {
    axios.get(APP_URL).catch(() => {});
}, 4 * 60 * 1000); // تنبيه كل 4 دقائق

// --- إدارة إعدادات المستخدمين ---
const getSettings = (chatId) => {
    const file = path.join(SESSIONS_DIR, String(chatId), 'settings.json');
    return fs.existsSync(file) ? fs.readJsonSync(file) : { emoji: "👑", autoView: true, autoReact: true, replies: [] };
};

const saveSettings = (chatId, data) => {
    const dir = path.join(SESSIONS_DIR, String(chatId));
    fs.ensureDirSync(dir);
    fs.writeJsonSync(path.join(dir, 'settings.json'), data);
};

// --- محرك الواتساب المحسن ---
async function startWhatsApp(chatId, phone) {
    const sessionDir = path.join(SESSIONS_DIR, String(chatId));

    // تنظيف أي محاولة ربط فاشلة سابقة لضمان الحصول على كود جديد
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
        // تم تغيير المتصفح ليبدو كجهاز ماك لتقليل نسبة كشف البوتات
        browser: ["Mac OS", "Chrome", "110.0.5481.177"], 
        printQRInTerminal: false,
        connectTimeoutMs: 100000,
        defaultQueryTimeoutMs: 0,
    });

    sessions.set(chatId, sock);

    // طلب كود الربط مع معالجة ذكية للأخطاء
    if (!sock.authState.creds.registered) {
        await delay(8000); // انتظار استقرار الاتصال
        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ كود الربط الخاص بك هو:\n\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, "❌ فشل طلب الكود حالياً بسبب قيود واتساب على السيرفر.\nيرجى المحاولة بعد قليل أو استخدام رقم آخر.");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            bot.sendMessage(chatId, "🔓 متصل بنجاح! البوت يقوم بمشاهدة الحالات والتفاعل الآن.");
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startWhatsApp(chatId, phone);
        }
    });

    // معالجة الرسائل والحالات
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const config = getSettings(chatId);
        const jid = m.key.remoteJid;

        if (jid === 'status@broadcast') {
            if (config.autoView) await sock.readMessages([m.key]);
            if (config.autoReact) {
                await sock.sendMessage('status@broadcast', { 
                    react: { key: m.key, text: config.emoji } 
                }, { statusJidList: [m.key.participant || m.key.remoteJid] });
            }
            return;
        }

        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase().trim();
        if (text === 'فحص') {
            await sock.sendMessage(jid, { text: "✅ البوت متصل ونظام الملكة يعمل!" }, { quoted: m });
        }
        
        const reply = config.replies.find(r => r.key.toLowerCase() === text);
        if (reply) await sock.sendMessage(jid, { text: reply.res }, { quoted: m });
    });
}

// --- أوامر تليجرام ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        bot.sendMessage(chatId, "👋 أهلاً بك! ارسل رقم واتساب الخاص بك مع مفتاح الدولة للربط.\nمثال: `967771234567`", { parse_mode: 'Markdown' });
    } else if (/^[0-9]{10,}$/.test(text?.replace('+', ''))) {
        bot.sendMessage(chatId, "⏳ جاري محاولة إنشاء جلسة وطلب الكود...");
        startWhatsApp(chatId, text.replace(/[^0-9]/g, ''));
    }
});

app.get('/', (req, res) => res.send("Bot Status: Active"));
app.listen(process.env.PORT || 10000);
