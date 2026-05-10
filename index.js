const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const pino = require('pino');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// توكن البوت الخاص بك
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new Telegraf(TG_TOKEN);

const sessionsDir = path.join(__dirname, 'sessions');
fs.ensureDirSync(sessionsDir);

// سيرفر الويب والبقاء حياً
app.get('/', (req, res) => res.send('Fares Queen: Online & Auto-Responding ✅'));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on ${PORT}`);
    // تنبيه السيرفر كل 4 دقائق لمنع النوم على Render
    setInterval(() => {
        const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/`;
        axios.get(url).catch(() => {});
    }, 4 * 60 * 1000);
});

async function startWhatsApp(chatId, phoneNumber) {
    const userSession = path.join(sessionsDir, String(chatId));
    fs.ensureDirSync(userSession);

    const { state, saveCreds } = await useMultiFileAuthState(userSession);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.creds.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: Browsers.macOS("Chrome"), // هوية متصفح موثوقة
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        await delay(5000); 
        try {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            await bot.telegram.sendMessage(chatId, `🔢 **كود الربط الخاص بك:**\n\n\`${code}\`\n\nقم بإدخاله الآن في واتساب > الأجهزة المرتبطة > ربط برقم الهاتف.`, { parse_mode: 'Markdown' });
        } catch (e) {
            await bot.telegram.sendMessage(chatId, "❌ فشل طلب الكود. يرجى المحاولة مرة أخرى لاحقاً.");
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => startWhatsApp(chatId, phoneNumber), 5000);
            }
        } else if (connection === 'open') {
            bot.telegram.sendMessage(chatId, "✅ **تم الربط بنجاح!**\nالبوت سيعمل الآن بدون توقف وسيتفاعل مع الحالات تلقائياً.");
        }
    });

    // التفاعل التلقائي مع الحالات
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid === 'status@broadcast') {
            try {
                await sock.readMessages([msg.key]);
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '💚', key: msg.key } }, { statusJidList: [msg.key.participant] });
            } catch (err) {}
        }
    });
}

// واجهة تليجرام - استجابة مباشرة بدون اشتراك إجباري
bot.start((ctx) => {
    ctx.reply("👑 أهلاً بك في نظام الملكة الذهبية.\n\nأرسل رقمك الآن (مثال: 96777xxxxxxx) وسأرسل لك كود الربط فوراً.");
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    // التحقق إذا كان النص عبارة عن أرقام فقط (رقم هاتف)
    if (/^\d+$/.test(text)) {
        await ctx.reply("⏳ جاري طلب الكود من واتساب، انتظر ثوانٍ...");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("⚠️ من فضلك أرسل رقم الهاتف فقط بشكل صحيح.");
    }
});

bot.launch().then(() => console.log("Telegram Bot Ready and Free!"));

// حماية السيرفر من التوقف عند الأخطاء المفاجئة
process.on('uncaughtException', (err) => console.error('Safe Error:', err));
process.on('unhandledRejection', (err) => console.error('Safe Rejection:', err));
