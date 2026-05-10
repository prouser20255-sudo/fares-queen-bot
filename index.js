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

const app = express();
const PORT = process.env.PORT || 10000;
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new TelegramBot(token, { polling: true });

app.get('/', (req, res) => res.send('System is Running... ✅'));
app.listen(PORT, '0.0.0.0');

async function startWhatsApp(chatId, phone) {
    const sessionPath = `./sessions/${chatId}`;
    
    // إزالة أي جلسة قديمة فوراً لضمان عدم حدوث تداخل في الأكواد
    if (fs.existsSync(sessionPath)) {
        try { fs.removeSync(sessionPath); } catch (e) { console.log("Session cleanup error"); }
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["Golden Queen", "Chrome", "1.0.0"], // اسم متصفح مخصص ليظهر في الاشعار
            syncFullHistory: false,
            printQRInTerminal: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            // انتظار 6 ثواني لضمان استقرار السيرفر قبل طلب الكود (حل مشكلة عدم وصول الاشعار)
            await delay(6000);
            try {
                let code = await sock.requestPairingCode(phone);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                await bot.sendMessage(chatId, `🔢 **كود الاقتران الخاص بك:**\n\n\`${code}\`\n\n⚠️ **تنبيه:** أدخل الكود في واتساب فوراً، ولا تطلب كوداً آخر حتى تنتهي هذه العملية.`, { parse_mode: 'Markdown' });
            } catch (err) {
                await bot.sendMessage(chatId, "❌ واتساب رفض الطلب مؤقتاً. انتظر دقيقتين وحاول مرة أخرى.");
            }
        }

        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect } = u;
            if (connection === 'open') {
                await bot.sendMessage(chatId, "🔓 **تم الربط بنجاح!**\nالبوت سيبدأ الآن بالتفاعل مع الحالات تلقائياً.");
            }
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    // لا تعيد الاتصال فوراً إذا تم إغلاق الجلسة يدوياً
                    setTimeout(() => startWhatsApp(chatId, phone), 5000);
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;
            if (m.key.remoteJid === 'status@broadcast') {
                await sock.readMessages([m.key]);
                await sock.sendMessage('status@broadcast', { react: { key: m.key, text: '💚' } }, { statusJidList: [m.key.participant] });
            }
        });

    } catch (e) {
        console.log("Global Error: ", e);
    }
}

bot.on('message', (msg) => {
    const text = msg.text?.trim();
    if (text && /^\d+$/.test(text)) {
        bot.sendMessage(msg.chat.id, "⏳ جاري تهيئة الطلب.. انتظر وصول الاشعار على هاتفك.");
        startWhatsApp(msg.chat.id, text);
    } else if (text === '/start') {
        bot.sendMessage(msg.chat.id, "👑 أهلاً بك في الملكة الذهبية.\nأرسل رقمك الآن (مثال: 96777xxxxxxx)");
    }
});
