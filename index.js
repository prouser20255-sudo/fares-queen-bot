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

// --- الإعدادات ---
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const app = express();
const bot = new TelegramBot(token, { polling: true });
const SESSIONS_DIR = './sessions';
fs.ensureDirSync(SESSIONS_DIR);

async function startBot(chatId, phone) {
    const sessionDir = path.join(SESSIONS_DIR, String(chatId));
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        // --- التعديل المطلوب لظهور المتصفح كـ Chrome (Ubuntu) ---
        browser: ["Ubuntu", "Chrome", "110.0.5481.177"], 
        printQRInTerminal: false,
        markOnlineOnConnect: true
    });

    if (!sock.authState.creds.registered) {
        await delay(5000);
        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ كود الربط الخاص بك هو:\n\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(chatId, "❌ فشل طلب الكود، انتظر قليلاً ثم حاول مجدداً.");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            bot.sendMessage(chatId, "🔓 تم الاتصال بنجاح كمتصفح Chrome (Ubuntu)!");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot(chatId, phone);
        }
    });

    // تنفيذ الحالات (Status)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe || m.key.remoteJid !== 'status@broadcast') return;
        await sock.readMessages([m.key]);
        await sock.sendMessage('status@broadcast', { react: { key: m.key, text: "👑" } }, { statusJidList: [m.key.participant] });
    });
}

// تشغيل عبر التليجرام
bot.on('message', async (msg) => {
    if (msg.text && /^[0-9]{10,}$/.test(msg.text.replace('+', ''))) {
        startBot(msg.chat.id, msg.text.replace(/[^0-9]/g, ''));
    }
});

app.get('/', (req, res) => res.send("Running..."));
app.listen(process.env.PORT || 10000);
