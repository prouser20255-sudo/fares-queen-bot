const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const pino = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// إعدادات التوكن والقناة
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new Telegraf(TG_TOKEN);

// إنشاء مجلد الجلسات تلقائياً لمنع أخطاء التشغيل
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

app.get('/', (req, res) => res.send('Bot is Running!'));
app.listen(PORT, () => console.log(`Server started on ${PORT}`));

async function startWhatsApp(chatId, phoneNumber) {
    const userSession = path.join(sessionsDir, String(chatId));
    if (!fs.existsSync(userSession)) fs.mkdirSync(userSession, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(userSession);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.creds.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: Browsers.ubuntu("Chrome")
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                await bot.telegram.sendMessage(chatId, `🔢 كود الاقتران الخاص بك:\n\n\`${code}\`\n\nقم بإدخاله في الواتساب الآن (الأجهزة المرتبطة > ربط هاتف).`, { parse_mode: 'Markdown' });
            } catch (e) {
                await bot.telegram.sendMessage(chatId, "❌ فشل طلب الكود. تأكد من الرقم ورمز الدولة.");
            }
        }, 4000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsApp(chatId, phoneNumber);
        } else if (connection === 'open') {
            bot.telegram.sendMessage(chatId, "✅ تم ربط الواتساب بنجاح! البوت سيتفاعل مع الحالات الآن.");
        }
    });

    // التفاعل التلقائي مع الحالات
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '💚', key: msg.key } }, { statusJidList: [msg.key.participant] });
        }
    });
}

// الرد على الرسائل في تليجرام
bot.start((ctx) => {
    ctx.reply("مرحباً بك في بوت Fares Queen 👑\nأرسل رقمك الآن مع رمز الدولة (مثال: 96777xxxxxxx) للحصول على كود الربط.");
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text)) {
        await ctx.reply("⏳ جاري طلب الكود من سيرفرات واتساب...");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("⚠️ من فضلك أرسل الرقم فقط (أرقام بدون فواصل).");
    }
});

// تشغيل البوت
bot.launch().then(() => console.log("Telegram Bot Ready!"));

// منع الانهيار
process.on('uncaughtException', (err) => console.error(err));
process.on('unhandledRejection', (err) => console.error(err));
