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
const sessionsDir = path.join(__dirname, 'sessions');

// تجهيز المجلدات والملفات
fs.ensureDirSync(sessionsDir);
if (!fs.existsSync(settingsFile)) {
    fs.writeJsonSync(settingsFile, { name: "GOLDEN QUEEN", emoji: "💚", mode: "public" });
}

// واجهة الويب لضمان عمل Render 24 ساعة
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send('<h1>نظام الملكة الذهبية يعمل بنجاح ✅</h1><p>البوت متصل الآن ومستعد للعمل 24 ساعة.</p>');
});

app.listen(PORT, () => console.log(`Server started on ${PORT}`));

// دالة جلب الإعدادات المحدثة
const getSettings = () => fs.readJsonSync(settingsFile);

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
        browser: Browsers.ubuntu("Chrome"), // تم التغيير لحل مشكلة تعليق تسجيل الدخول
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000 
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        await delay(5000); // تأخير لضمان استقرار الاتصال قبل طلب الكود
        try {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            await bot.telegram.sendMessage(chatId, `🔢 **كود الاقتران الخاص بك:**\n\n\`${code}\`\n\nقم بإدخاله في الواتساب الآن (الأجهزة المرتبطة > ربط هاتف).`, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error(e);
            await bot.telegram.sendMessage(chatId, "❌ فشل طلب الكود. يرجى المحاولة مرة أخرى بعد قليل.");
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsApp(chatId, phoneNumber);
        } else if (connection === 'open') {
            bot.telegram.sendMessage(chatId, "✅ تم ربط الواتساب بنجاح!\nالبوت سيتفاعل مع الحالات الآن 24 ساعة بدون توقف.");
        }
    });

    // التفاعل مع الحالات والأوامر
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        const isMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const config = getSettings();
        const msgText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // نظام الأوامر من الرقم المربوط (أنت)
        if (isMe) {
            if (msgText === 'اوامر') {
                const menu = `👑 *إعدادات الملكة الذهبية*\n\n` +
                             `⚙️ الإيموجي الحالي: ${config.emoji}\n` +
                             `📈 الحالة: نشط 24/7\n\n` +
                             `*الأوامر المتاحة:*\n` +
                             `1️⃣ .تغيير (وضع الإيموجي الجديد)\n` +
                             `2️⃣ .تحديث (إعادة تشغيل البوت)`;
                await sock.sendMessage(remoteJid, { text: menu });
            }
            if (msgText.startsWith('.تغيير ')) {
                const newEmoji = msgText.split(' ')[1];
                if (newEmoji) {
                    fs.writeJsonSync(settingsFile, { ...config, emoji: newEmoji });
                    await sock.sendMessage(remoteJid, { text: `✅ تم تحديث إيموجي التفاعل إلى: ${newEmoji}` });
                }
            }
            if (msgText === '.تحديث') {
                await sock.sendMessage(remoteJid, { text: "🔄 جاري إعادة تشغيل النظام..." });
                process.exit();
            }
        }

        // التفاعل التلقائي مع الحالات
        if (!isMe && remoteJid === 'status@broadcast') {
            try {
                await sock.readMessages([msg.key]);
                await sock.sendMessage(remoteJid, { react: { text: config.emoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
            } catch (e) {
                // خطأ بسيط في القراءة، يتم التخطي
            }
        }
    });
}

// بوت تليجرام
bot.start((ctx) => {
    ctx.reply("👑 مرحباً بك في نظام الملكة الذهبية المطور.\nأرسل رقمك الآن مع مفتاح الدولة (مثال: 96777xxxxxxx) للبدء.");
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text)) {
        await ctx.reply("⏳ جاري تهيئة الاتصال وطلب الكود من واتساب...");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("⚠️ يرجى إرسال أرقام فقط.");
    }
});

bot.launch();

// معالجة الأخطاء لضمان الاستمرارية
process.on('uncaughtException', (err) => console.log('Recovered from error:', err));
process.on('unhandledRejection', (err) => console.log('Recovered from rejection:', err));
