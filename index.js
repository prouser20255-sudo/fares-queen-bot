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
const axios = require('axios'); // لإبقاء السيرفر حياً

const app = express();
const PORT = process.env.PORT || 10000;

// إعدادات التوكن
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new Telegraf(TG_TOKEN);

// إعداد المجلدات
const sessionsDir = path.join(__dirname, 'sessions');
fs.ensureDirSync(sessionsDir);

app.get('/', (req, res) => res.send('Fares Queen Bot is Active 24/7 ✅'));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on ${PORT}`);
    
    // كود لمنع السيرفر من النوم (Ping)
    setInterval(() => {
        axios.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/`).catch(() => {});
    }, 5 * 60 * 1000); // كل 5 دقائق
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
        browser: Browsers.ubuntu("Chrome"), // هوية مستقرة
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000 // الحفاظ على النبض مع واتساب
    });

    sock.ev.on('creds.update', saveCreds);

    // طلب كود الاقتران
    if (!sock.authState.creds.registered) {
        await delay(5000); // انتظار استقرار الجلسة
        try {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            await bot.telegram.sendMessage(chatId, `🔢 **كود الاقتران الخاص بك:**\n\n\`${code}\`\n\nأدخله في واتساب الآن (الأجهزة المرتبطة > ربط برقم هاتف).`, { parse_mode: 'Markdown' });
        } catch (e) {
            await bot.telegram.sendMessage(chatId, "❌ فشل طلب الكود. يرجى المحاولة لاحقاً.");
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            // إعادة الاتصال دائماً إلا إذا سجل المستخدم خروجه يدوياً
            if (reason !== DisconnectReason.loggedOut) {
                console.log("Reconnecting...");
                setTimeout(() => startWhatsApp(chatId, phoneNumber), 5000);
            }
        } else if (connection === 'open') {
            bot.telegram.sendMessage(chatId, "✅ **تم الاتصال بنجاح!**\nالرقم الآن متصل وسيتفاعل مع الحالات تلقائياً بدون توقف.");
        }
    });

    // التفاعل التلقائي مع الحالات (Auto-Status)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        if (msg.key.remoteJid === 'status@broadcast') {
            try {
                await sock.readMessages([msg.key]);
                await sock.sendMessage(msg.key.remoteJid, { 
                    react: { text: '💚', key: msg.key } 
                }, { statusJidList: [msg.key.participant] });
            } catch (err) {
                console.error("Status React Error:", err);
            }
        }
    });
}

// واجهة تليجرام
bot.start((ctx) => {
    ctx.reply("👑 مرحباً بك في نظام الملكة الذهبية\n\nأرسل رقمك الآن (مثال: 96777xxxxxxx) للحصول على كود الربط والتشغيل 24 ساعة.");
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text)) {
        await ctx.reply("⏳ جاري تهيئة الاتصال السريع... انتظر الكود.");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("⚠️ يرجى إرسال أرقام فقط.");
    }
});

bot.launch().then(() => console.log("Telegram Bot Ready!"));

// منع توقف البوت عند حدوث خطأ غير متوقع
process.on('uncaughtException', (err) => console.error('Global Error:', err));
process.on('unhandledRejection', (err) => console.error('Global Rejection:', err));
