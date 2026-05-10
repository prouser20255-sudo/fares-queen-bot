const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    fetchLatestBaileysVersion, 
    DisconnectReason,
    Browsers 
} = require("@whiskeysockets/baileys");
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new TelegramBot(token, { polling: true });
const settingsFile = './settings.json';

// رابط الربط الخاص بك
const PAIRING_URL = "https://fares-queen-bot.onrender.com";

// تهيئة الملفات والمجلدات
fs.ensureDirSync('./sessions');
if (!fs.existsSync(settingsFile)) {
    fs.writeJsonSync(settingsFile, { name: "GOLDEN QUEEN", emoji: "👑" });
}

// واجهة الويب لضمان عمل السيرفر 24 ساعة (تجاوز فشل Render)
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
        <div style="text-align:center; padding:50px; font-family:sans-serif;">
            <h1 style="color:#d4a017;">نظام الملكة الذهبية نشط ✅</h1>
            <p>السيرفر يعمل الآن على منفذ: ${PORT}</p>
            <p>رابط الاقتران: <a href="${PAIRING_URL}">${PAIRING_URL}</a></p>
        </div>
    `);
});

async function startBot(chatId, phone) {
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${chatId}`);
    
    try {
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu("Chrome"), // حل مشكلة "جارٍ تسجيل الدخول"
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            await delay(5000);
            try {
                const code = await sock.requestPairingCode(phone);
                await bot.sendMessage(chatId, `🔢 كود الاقتران الخاص بك:\n\n\`${code}\`\n\nأدخله الآن في الواتساب.`, { parse_mode: 'Markdown' });
            } catch (err) {
                bot.sendMessage(chatId, "❌ فشل طلب الكود، يرجى المحاولة مرة أخرى.");
            }
        }

        sock.ev.on('connection.update', (u) => {
            const { connection, lastDisconnect } = u;
            if (connection === 'open') {
                bot.sendMessage(chatId, "✅ تم ربط الواتساب بنجاح! البوت يعمل الآن 24 ساعة.");
            }
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) startBot(chatId, phone);
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;
            const config = fs.readJsonSync(settingsFile);
            
            if (m.key.remoteJid === 'status@broadcast') {
                await sock.readMessages([m.key]);
                await sock.sendMessage('status@broadcast', { react: { key: m.key, text: config.emoji } }, { statusJidList: [m.key.participant] });
            }
        });

    } catch (err) {
        console.error("WhatsApp Error:", err);
    }
}

bot.on('message', (msg) => {
    const text = msg.text?.trim();
    if (text && /^\d+$/.test(text)) {
        bot.sendMessage(msg.chat.id, "⏳ جاري تهيئة الاتصال وطلب الكود...");
        startBot(msg.chat.id, text);
    }
});

// تشغيل السيرفر
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

// حل نهائي لمشكلة Exited with status 1 (منع الانهيار)
process.on('uncaughtException', (err) => console.error('Caught exception: ', err));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection at:', promise, 'reason:', reason));
