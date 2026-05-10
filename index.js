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

// --- الإعدادات (التوكن الخاص بك) ---
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new Telegraf(TG_TOKEN);
const app = express();
const PORT = process.env.PORT || 10000;

// مجلد الجلسات
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

// سيرفر للبقاء حياً (Ping)
app.get('/', (req, res) => res.send('Fares Queen Bot is Active 24/7'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
        browser: Browsers.macOS("Desktop"), // تغيير المتصفح لثبات أفضل
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    // طلب كود الاقتران
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                await bot.telegram.sendMessage(chatId, `🔢 **كود الاقتران الخاص بك هو:**\n\n\`${code}\`\n\nضع الكود في الواتساب (الأجهزة المرتبطة).`, { parse_mode: 'Markdown' });
            } catch (e) {
                console.log("Error requesting code:", e);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("Reconnecting...");
                startWhatsApp(chatId, phoneNumber);
            }
        } else if (connection === 'open') {
            console.log("WhatsApp Connected!");
            await bot.telegram.sendMessage(chatId, "✅ تم ربط الرقم بنجاح! سيتم التفاعل مع الحالات الآن بدون توقف.");
        }
    });

    // التفاعل مع الحالات (Status)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        if (msg.key.remoteJid === 'status@broadcast') {
            const sender = msg.key.participant;
            await sock.readMessages([msg.key]); // مشاهدة الحالة
            // تفاعل تلقائي بقلب أخضر
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '💚', key: msg.key } }, { statusJidList: [sender] });
        }
    });
}

// أوامر التليجرام (نظيفة تماماً)
bot.start((ctx) => {
    ctx.reply("مرحباً بك في بوت Fares Queen الجديد 👑\n\nأرسل رقمك الآن مع رمز الدولة (مثال: 96777xxxxxxx) لربط الواتساب.");
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text)) {
        ctx.reply("⏳ جاري توليد كود الاقتران، انتظر قليلاً...");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("⚠️ ارسل الرقم كأرقام فقط (مثال: 967771163825)");
    }
});

bot.launch();

// معالجة الأخطاء لمنع توقف البوت
process.on('uncaughtException', (err) => console.log('Error:', err));
process.on('unhandledRejection', (err) => console.log('Promise Error:', err));
