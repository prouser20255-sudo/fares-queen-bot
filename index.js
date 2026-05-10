const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const pino = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000; // ريندر يستخدم غالباً 10000

// --- الإعدادات ---
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const CHANNEL_LINK = 'https://t.me/fz_z_Z';

const bot = new Telegraf(TG_TOKEN);

// تأكد من وجود مجلد الجلسات لمنع الانهيار
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
}

app.get('/', (req, res) => res.send('Fares Queen Bot is Active!'));
app.listen(PORT, () => console.log(`✅ Server is running on port ${PORT}`));

async function startWhatsApp(chatId, phoneNumber) {
    const userSessionPath = path.join(sessionsDir, String(chatId));
    
    // إنشاء مجلد خاص لكل مستخدم إذا لم يوجد
    if (!fs.existsSync(userSessionPath)) {
        fs.mkdirSync(userSessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(userSessionPath);
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.creds.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: ["Fares-Queen", "Chrome", "1.0.0"]
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                await bot.telegram.sendMessage(chatId, `🔢 كود الاقتران: \`${code}\``, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error("Pairing Error:", e);
            }
        }, 5000); // زيادة وقت الانتظار قليلاً لضمان الاستقرار
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsApp(chatId, phoneNumber);
        } else if (connection === 'open') {
            bot.telegram.sendMessage(chatId, "✅ تم الربط بنجاح! البوت سيتفاعل مع الحالات الآن.");
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const msg = chatUpdate.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '💚', key: msg.key } }, { statusJidList: [msg.key.participant] });
        }
    });
}

bot.start((ctx) => ctx.reply("أرسل رقمك مع رمز الدولة للبدء (مثال: 9677xxxxxxxx)"));

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text)) {
        ctx.reply("⏳ جاري طلب الكود...");
        startWhatsApp(ctx.chat.id, text).catch(err => {
            console.error("WhatsApp Start Error:", err);
            ctx.reply("❌ حدث خطأ داخلي، حاول مجدداً.");
        });
    }
});

// تشغيل البوت مع معالجة أخطاء الإطلاق
bot.launch().then(() => {
    console.log("🚀 Telegram Bot is running...");
}).catch((err) => {
    console.error("❌ Failed to launch Telegram Bot:", err);
});

// منع انهيار التطبيق عند حدوث خطأ غير متوقع
process.on('uncaughtException', (err) => {
    console.error('There was an uncaught error', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
