
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

// واجهة الويب لضمان التشغيل
app.get('/', (req, res) => res.send('<h1>نظام الملكة الذهبية متصل ✅</h1>'));
app.listen(PORT, '0.0.0.0');

async function startWhatsApp(chatId, phone) {
    const sessionPath = `./sessions/${chatId}`;
    
    // تنظيف الجلسة القديمة لضمان طلب كود جديد بنجاح
    if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu("Chrome"),
            syncFullHistory: false,
            connectTimeoutMs: 60000
        });

        sock.ev.on('creds.update', saveCreds);

        // طلب الكود
        if (!sock.authState.creds.registered) {
            await delay(3000);
            try {
                const code = await sock.requestPairingCode(phone);
                await bot.sendMessage(chatId, `✅ كود الربط الخاص بك:\n\n\`${code}\``, { parse_mode: 'Markdown' });
            } catch (err) {
                console.log(err);
                await bot.sendMessage(chatId, "❌ فشل طلب الكود. يرجى الانتظار 5 دقائق ثم إرسال الرقم مرة أخرى.");
            }
        }

        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect } = u;
            if (connection === 'open') {
                await bot.sendMessage(chatId, "🔓 تم الربط بنجاح! البوت سيتفاعل مع الحالات الآن.");
            }
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) startWhatsApp(chatId, phone);
            }
        });

        // التفاعل التلقائي مع الحالات
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;
            if (m.key.remoteJid === 'status@broadcast') {
                await sock.readMessages([m.key]);
                await sock.sendMessage('status@broadcast', { react: { key: m.key, text: '💚' } }, { statusJidList: [m.key.participant] });
            }
        });

    } catch (e) {
        console.log(e);
    }
}

// استقبال الأرقام من تلجرام
bot.on('message', (msg) => {
    const text = msg.text?.trim();
    if (text && /^\d+$/.test(text)) {
        bot.sendMessage(msg.chat.id, "⏳ جاري طلب كود جديد، انتظر...");
        startWhatsApp(msg.chat.id, text);
    } else if (text === '/start') {
        bot.sendMessage(msg.chat.id, "👑 أهلاً بك في الملكة الذهبية.\nأرسل رقمك الآن (مثال: 96777xxxxxxx)");
    }
});

// معالجة الأخطاء
process.on('uncaughtException', (err) => console.log('Error Ignored:', err));
process.on('unhandledRejection', (err) => console.log('Rejection Ignored:', err));
