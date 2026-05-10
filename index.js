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
const APP_URL = "https://fares-queen-bot.onrender.com"; // رابط الموقع الخاص بك

const app = express();
const bot = new TelegramBot(token, { polling: true });
const sessions = new Map();

const SESSIONS_DIR = './sessions';
fs.ensureDirSync(SESSIONS_DIR);

// --- نظام منع توقف السيرفر (Self-Ping) ---
setInterval(() => {
    axios.get(APP_URL).then(() => {
        console.log('Keep-alive: Pinged ' + APP_URL);
    }).catch((err) => {
        console.error('Keep-alive error:', err.message);
    });
}, 5 * 60 * 1000); // تم تقليل المدة لـ 5 دقائق لضمان النشاط

// --- إدارة البيانات ---
const getUserSettings = (chatId) => {
    const filePath = path.join(SESSIONS_DIR, String(chatId), 'settings.json');
    if (fs.existsSync(filePath)) {
        return fs.readJsonSync(filePath);
    }
    return {
        emoji: "👑",
        autoViewStatus: true,
        autoReactStatus: true,
        alwaysOnline: true,
        autoReplies: []
    };
};

const saveUserSettings = (chatId, data) => {
    const userDir = path.join(SESSIONS_DIR, String(chatId));
    fs.ensureDirSync(userDir);
    fs.writeJsonSync(path.join(userDir, 'settings.json'), data);
};

// --- محرك الواتساب المحسن ---
async function startBot(chatId, phone) {
    // إغلاق أي جلسة قديمة لنفس المستخدم لتجنب "فشل طلب الكود"
    if (sessions.has(chatId)) {
        try {
            sessions.get(chatId).end();
            sessions.delete(chatId);
        } catch (e) {}
    }

    const sessionDir = path.join(SESSIONS_DIR, String(chatId));
    
    // تنظيف المجلد إذا لم يكن هناك تسجيل دخول مكتمل
    if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        fs.emptyDirSync(sessionDir);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000, // زيادة مهلة الاتصال
    });

    sessions.set(chatId, sock);

    // طلب كود الربط
    if (!sock.authState.creds.registered) {
        await delay(5000);
        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ كود الربط الخاص بك هو:\n\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("Pairing Error:", e);
            bot.sendMessage(chatId, "❌ فشل طلب الكود.\nتأكد من أن الرقم صحيح ومنتظم، وحاول مجدداً بعد دقيقة.");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            bot.sendMessage(chatId, "🔓 تم الاتصال بنجاح! البوت الآن يعمل على حسابك.");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot(chatId, phone);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const config = getUserSettings(chatId);
        const remoteJid = m.key.remoteJid;

        // نظام الحالات
        if (remoteJid === 'status@broadcast') {
            if (config.autoViewStatus) await sock.readMessages([m.key]);
            if (config.autoReactStatus) {
                await sock.sendMessage('status@broadcast', { 
                    react: { key: m.key, text: config.emoji } 
                }, { statusJidList: [m.key.participant || m.key.remoteJid] });
            }
            return;
        }

        // الردود التلقائية
        const msgText = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase().trim();
        
        if (msgText === 'فحص') {
            await sock.sendMessage(remoteJid, { text: `✅ نظام الملكة الذهبية يعمل!\n🔗 الرابط: ${APP_URL}` }, { quoted: m });
        }

        const foundReply = config.autoReplies.find(r => r.key.toLowerCase() === msgText);
        if (foundReply) {
            await sock.sendMessage(remoteJid, { text: foundReply.res }, { quoted: m });
        }
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

    bot.sendMessage(msg.chat.id, `👋 أهلاً بك في GOLDEN QUEEN\nارسل رقمك مع مفتاح الدولة للربط.\nمثال: 96777xxxxxxx\n\n🔗 لوحة التحكم:\n${APP_URL}`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "⚙️ الإعدادات", callback_data: "set" }],
                [{ text: "➕ إضافة رد تلقائي", callback_data: "add_r" }]
            ]
        }
    });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const config = getUserSettings(chatId);

    if (query.data === "set") {
        bot.sendMessage(chatId, `🛠 إعداداتك الحالية:\n- التفاعل: ${config.emoji}\n- مشاهدة الحالات: ${config.autoViewStatus ? "✅" : "❌"}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📝 تغيير الإيموجي", callback_data: "ch_em" }],
                    [{ text: "تبديل المشاهدة", callback_data: "tog_view" }]
                ]
            }
        });
    }
    // ... بقية معالجات الـ callback (add_r, ch_em, tog_view) كما في الكود السابق
});

bot.on('message', async (msg) => {
    if (msg.text && /^[0-9]{10,}$/.test(msg.text.replace('+', ''))) {
        const isSub = await checkSub(msg.chat.id);
        if (!isSub) return bot.sendMessage(msg.chat.id, `⚠️ اشترك أولاً: ${CHANNEL_USER}`);
        bot.sendMessage(msg.chat.id, "⏳ جاري محاولة إنشاء كود الربط...");
        startBot(msg.chat.id, msg.text.replace(/[^0-9]/g, ''));
    }
});

app.get('/', (req, res) => res.send("Bot is Running..."));
app.listen(process.env.PORT || 10000);
