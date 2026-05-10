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
const axios = require('axios');

// --- الإعدادات الأساسية ---
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const ADMIN_ID = 544321234; 
const CHANNEL_USER = "@fz_z_Z"; 
const APP_URL = "https://fares-queen-bot.onrender.com"; 

const app = express();
const bot = new TelegramBot(token, { polling: true });
const sessions = new Map();

const SESSIONS_DIR = './sessions';
fs.ensureDirSync(SESSIONS_DIR);

// --- نظام منع توقف السيرفر (Keep-Alive) ---
setInterval(() => {
    axios.get(APP_URL).catch(() => {});
}, 5 * 60 * 1000);

// --- إدارة البيانات ---
const getUserSettings = (chatId) => {
    const filePath = path.join(SESSIONS_DIR, String(chatId), 'settings.json');
    if (fs.existsSync(filePath)) return fs.readJsonSync(filePath);
    return { emoji: "👑", autoViewStatus: true, autoReactStatus: true, autoReplies: [] };
};

const saveUserSettings = (chatId, data) => {
    const userDir = path.join(SESSIONS_DIR, String(chatId));
    fs.ensureDirSync(userDir);
    fs.writeJsonSync(path.join(userDir, 'settings.json'), data);
};

// --- محرك الواتساب (نسخة التنظيف العميق) ---
async function startBot(chatId, phone) {
    const sessionDir = path.join(SESSIONS_DIR, String(chatId));

    // 1. تنظيف شامل قبل البدء (Deep Clean)
    if (sessions.has(chatId)) {
        try {
            const oldSock = sessions.get(chatId);
            oldSock.ev.removeAllListeners();
            oldSock.end();
            sessions.delete(chatId);
        } catch (e) {}
    }

    // إذا كان المجلد موجوداً ولم يتم الربط بعد، نحذفه تماماً لنبدأ من الصفر
    if (fs.existsSync(sessionDir) && !fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        fs.removeSync(sessionDir);
    }
    fs.ensureDirSync(sessionDir);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        // تغيير هوية المتصفح إلى macOS Desktop لتقليل نسبة الحظر
        browser: ["Mac OS", "Chrome", "121.0.6167.184"],
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 90000, // زيادة المهلة لـ 90 ثانية
        defaultQueryTimeoutMs: 0,
    });

    sessions.set(chatId, sock);

    // 2. الانتظار حتى يستقر الاتصال بالخادم قبل طلب الكود
    if (!sock.authState.creds.registered) {
        await delay(10000); // انتظار 10 ثوانٍ كاملة
        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ كود الربط الخاص بك هو:\n\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("Error Requesting Code:", e);
            bot.sendMessage(chatId, "❌ فشل طلب الكود.\n\n**السبب المحتمل:** خوادم واتساب ترفض الطلبات المتكررة من هذا السيرفر حالياً.\n**الحل:** انتظر 15 دقيقة ثم ارسل الرقم مرة أخرى.");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            bot.sendMessage(chatId, "🔓 تم الاتصال بنجاح! البوت الآن يعمل.");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot(chatId, phone);
        }
    });

    // معالجة الرسائل والحالات كما هي
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        const config = getUserSettings(chatId);
        const remoteJid = m.key.remoteJid;

        if (remoteJid === 'status@broadcast') {
            if (config.autoViewStatus) await sock.readMessages([m.key]);
            if (config.autoReactStatus) {
                await sock.sendMessage('status@broadcast', { 
                    react: { key: m.key, text: config.emoji } 
                }, { statusJidList: [m.key.participant || m.key.remoteJid] });
            }
            return;
        }

        const msgText = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase().trim();
        if (msgText === 'فحص') {
            await sock.sendMessage(remoteJid, { text: `✅ نظام الملكة الذهبية يعمل!\n🔗 ${APP_URL}` }, { quoted: m });
        }
        const foundReply = config.autoReplies.find(r => r.key.toLowerCase() === msgText);
        if (foundReply) await sock.sendMessage(remoteJid, { text: foundReply.res }, { quoted: m });
    });
}

// --- أوامر تليجرام ---
async function checkSub(chatId) {
    try {
        const member = await bot.getChatMember(CHANNEL_USER, chatId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch { return false; }
}

bot.onText(/\/start/, async (msg) => {
    const isSub = await checkSub(msg.chat.id);
    if (!isSub) return bot.sendMessage(msg.chat.id, `⚠️ اشترك أولاً في القناة:\n🔗 ${CHANNEL_USER}`);

    bot.sendMessage(msg.chat.id, `👋 أهلاً بك في GOLDEN QUEEN\nارسل رقمك للربط (967xxxxxxx)\n\n🔗 لوحة التحكم:\n${APP_URL}`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "⚙️ الإعدادات", callback_data: "set" }],
                [{ text: "➕ إضافة رد تلقائي", callback_data: "add_r" }]
            ]
        }
    });
});

bot.on('message', async (msg) => {
    if (msg.text && /^[0-9]{10,}$/.test(msg.text.replace('+', ''))) {
        const isSub = await checkSub(msg.chat.id);
        if (!isSub) return bot.sendMessage(msg.chat.id, `⚠️ اشترك أولاً: ${CHANNEL_USER}`);
        bot.sendMessage(msg.chat.id, "⏳ جاري تهيئة جلسة نظيفة وطلب الكود...");
        startBot(msg.chat.id, msg.text.replace(/[^0-9]/g, ''));
    }
});

// الأكواد الباقية للـ Callback Query...
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const config = getUserSettings(chatId);
    if (query.data === "set") {
        bot.sendMessage(chatId, `🛠 إعداداتك:\nإيموجي: ${config.emoji}\nمشاهدة الحالات: ${config.autoViewStatus ? "✅" : "❌"}`, {
            reply_markup: { inline_keyboard: [[{ text: "📝 تغيير الإيموجي", callback_data: "ch_em" }], [{ text: "تبديل المشاهدة", callback_data: "tog_view" }]] }
        });
    }
    if (query.data === "add_r") {
        bot.sendMessage(chatId, "📌 ارسل الكلمة المفتاحية:");
        bot.once('message', (m1) => {
            if (m1.chat.id !== chatId) return;
            bot.sendMessage(chatId, `✅ الكلمة: ${m1.text}\nالآن ارسل الرد:`);
            bot.once('message', (m2) => {
                if (m2.chat.id !== chatId) return;
                config.autoReplies.push({ key: m1.text, res: m2.text });
                saveUserSettings(chatId, config);
                bot.sendMessage(chatId, "✅ تم الحفظ!");
            });
        });
    }
    if (query.data === "ch_em") {
        bot.sendMessage(chatId, "ارسل الإيموجي الجديد:");
        bot.once('message', (m) => {
            if (m.chat.id === chatId) {
                config.emoji = m.text;
                saveUserSettings(chatId, config);
                bot.sendMessage(chatId, "✅ تم التغيير.");
            }
        });
    }
    if (query.data === "tog_view") {
        config.autoViewStatus = !config.autoViewStatus;
        saveUserSettings(chatId, config);
        bot.answerCallbackQuery(query.id, { text: "تم التحديث" });
    }
});

app.get('/', (req, res) => res.json({ status: "Active", url: APP_URL }));
app.listen(process.env.PORT || 10000);
