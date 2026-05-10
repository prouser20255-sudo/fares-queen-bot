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

const app = express();
const PORT = process.env.PORT || 10000;

// إعدادات التوكن والقناة
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new Telegraf(TG_TOKEN);
const settingsFile = './settings.json';

// التأكد من المجلدات والملفات
const sessionsDir = path.join(__dirname, 'sessions');
fs.ensureDirSync(sessionsDir);
if (!fs.existsSync(settingsFile)) {
    fs.writeJsonSync(settingsFile, { name: "GOLDEN QUEEN", emoji: "💚", mode: "public" });
}

// واجهة الويب لضمان بقاء السيرفر حياً (24 ساعة)
app.get('/', (req, res) => res.send('GOLDEN QUEEN SYSTEM IS ACTIVE ✅'));
app.listen(PORT, () => console.log(`Server started on ${PORT}`));

// دالة جلب الإعدادات
const getSettings = () => fs.readJsonSync(settingsFile);

async function startWhatsApp(chatId, phoneNumber) {
    const userSession = path.join(sessionsDir, String(chatId));
    fs.ensureDirSync(userSession);

    const { state, saveCreds } = await useMultiFileAuthState(userSession);
    const { version } = await fetchLatestVersion();

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.creds.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: Browsers.ubuntu("Chrome"), // تغيير المتصفح لضمان عدم التوقف
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000 // إرسال نبضات للسيرفر كل 10 ثواني للبقاء متصلاً
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        await delay(4000);
        try {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            await bot.telegram.sendMessage(chatId, `🔢 كود الاقتران الخاص بك:\n\n\`${code}\`\n\nقم بإدخاله في الواتساب الآن.`, { parse_mode: 'Markdown' });
        } catch (e) {
            await bot.telegram.sendMessage(chatId, "❌ فشل طلب الكود. حاول لاحقاً.");
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("إعادة الاتصال تلقائياً...");
                startWhatsApp(chatId, phoneNumber);
            }
        } else if (connection === 'open') {
            await bot.telegram.sendMessage(chatId, "✅ تم ربط الواتساب بنجاح! البوت سيعمل الآن 24 ساعة بدون توقف.");
        }
    });

    // التفاعل التلقائي مع الحالات والأوامر
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        const isMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const config = getSettings();
        const msgText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // أوامر المالك من داخل الواتساب
        if (isMe) {
            if (msgText === 'اوامر') {
                const menu = `👑 *لوحة تحكم GOLDEN QUEEN*\n\n🔹 الايموجي الحالي: ${config.emoji}\n🔹 الحالة: متصل ونشط ✅\n\n*الأوامر:* \n.تغيير [الايموجي]\n.تحديث (لإعادة التشغيل)`;
                await sock.sendMessage(remoteJid, { text: menu });
            }
            if (msgText.startsWith('.تغيير ')) {
                const newEmoji = msgText.split(' ')[1];
                fs.writeJsonSync(settingsFile, { ...config, emoji: newEmoji });
                await sock.sendMessage(remoteJid, { text: `✅ تم تغيير إيموجي التفاعل إلى: ${newEmoji}` });
            }
            if (msgText === '.تحديث') {
                await sock.sendMessage(remoteJid, { text: "🔄 جاري إعادة التشغيل..." });
                process.exit();
            }
        }

        // التفاعل مع الحالات تلقائياً بناءً على الإيموجي المحفوظ
        if (!isMe && remoteJid === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            await sock.sendMessage(remoteJid, { react: { text: config.emoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
        }
    });
}

// وظيفة لجلب إصدار واتساب لضمان التوافق
async function fetchLatestVersion() {
    return { version: [2, 3000, 1015901307] };
}

// بوت تليجرام
bot.start((ctx) => {
    ctx.reply("مرحباً بك في بوت Fares Queen المتطور 👑\nأرسل رقمك الآن (مثال: 96777xxxxxxx) للحصول على كود الربط.");
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text)) {
        await ctx.reply("⏳ جاري طلب الكود وتهيئة الاتصال الدائم...");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("⚠️ من فضلك أرسل الرقم فقط.");
    }
});

bot.launch().then(() => console.log("Telegram Bot Ready!"));

// أوامر منع التوقف والانهيار (Critical for 24/7)
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
