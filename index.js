const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    fetchLatestBaileysVersion, 
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');

// --- الإعدادات الأساسية ---
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const ADMIN_ID = 544321234; // معرف المطور
const CHANNEL_USER = "@fz_z_Z"; 
const app = express();
const bot = new TelegramBot(token, { polling: true });
const sessions = new Map();

const SESSIONS_DIR = './sessions';
fs.ensureDirSync(SESSIONS_DIR);

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

// --- محرك الواتساب ---
async function startBot(chatId, phone) {
    const sessionDir = path.join(SESSIONS_DIR, String(chatId));
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (requiresPatch) {
                message = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...message } } };
            }
            return message;
        }
    });

    sessions.set(chatId, sock);

    // توليد كود الربط
    if (!sock.authState.creds.registered) {
        await delay(5000);
        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ كود الربط الخاص بك هو:\n\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(chatId, "❌ فشل طلب الكود، تأكد من الرقم.");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            bot.sendMessage(chatId, "🔓 تم الاتصال! البوت يشاهد ويتفاعل مع الحالات الآن.");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot(chatId, phone);
        }
    });

    // --- معالجة الحالات والرسائل ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const config = getUserSettings(chatId);
        const remoteJid = m.key.remoteJid;

        // 1. نظام الحالات (Status)
        if (remoteJid === 'status@broadcast') {
            const participant = m.key.participant || m.key.remoteJid;
            if (config.autoViewStatus) {
                await sock.readMessages([m.key]);
            }
            if (config.autoReactStatus) {
                await sock.sendMessage('status@broadcast', { 
                    react: { key: m.key, text: config.emoji } 
                }, { statusJidList: [participant] });
            }
            return;
        }

        // 2. أمر فحص (داخل الواتساب)
        const msgText = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
        if (msgText.toLowerCase() === 'فحص') {
            await sock.sendMessage(remoteJid, { text: `✅ نظام الملكة الذهبية يعمل بنجاح!\n\n🤖 إحصائياتك:\n- الردود التلقائية: ${config.autoReplies.length}\n- التفاعل: ${config.emoji}` }, { quoted: m });
        }

        // 3. تنفيذ الردود التلقائية المضافة
        const foundReply = config.autoReplies.find(r => r.key.toLowerCase() === msgText.toLowerCase());
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

    bot.sendMessage(msg.chat.id, `👋 أهلاً بك في GOLDEN QUEEN\nارسل رقمك للربط (مثال: 967xxxxxxx)`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "⚙️ الإعدادات", callback_data: "set" }],
                [{ text: "➕ إضافة رد تلقائي", callback_data: "add_r" }]
            ]
        }
    });
});

bot.onText(/\/admin/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const users = fs.readdirSync(SESSIONS_DIR).length;
    bot.sendMessage(msg.chat.id, `📊 إحصائيات المطور:\n- عدد المستخدمين: ${users}\n- الرام المستخدم: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const config = getUserSettings(chatId);

    if (query.data === "set") {
        bot.sendMessage(chatId, `🛠 إعداداتك:\nإيموجي: ${config.emoji}\nمشاهدة الحالات: ${config.autoViewStatus ? "✅" : "❌"}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📝 تغيير الإيموجي", callback_data: "ch_em" }],
                    [{ text: "تبديل المشاهدة", callback_data: "tog_view" }]
                ]
            }
        });
    }

    if (query.data === "add_r") {
        bot.sendMessage(chatId, "📌 ارسل الكلمة (التي سيرسلها الشخص):");
        bot.once('message', (m1) => {
            if (m1.chat.id !== chatId) return;
            const key = m1.text;
            bot.sendMessage(chatId, `✅ الكلمة: ${key}\nالآن ارسل الرد الذي تريده:`);
            bot.once('message', (m2) => {
                if (m2.chat.id !== chatId) return;
                config.autoReplies.push({ key: key, res: m2.text });
                saveUserSettings(chatId, config);
                bot.sendMessage(chatId, "✅ تم إضافة الرد بنجاح!");
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

bot.on('message', async (msg) => {
    if (msg.text && /^[0-9]{10,}$/.test(msg.text.replace('+', ''))) {
        const isSub = await checkSub(msg.chat.id);
        if (!isSub) return bot.sendMessage(msg.chat.id, `⚠️ اشترك أولاً: ${CHANNEL_USER}`);
        bot.sendMessage(msg.chat.id, "⏳ جاري الربط...");
        startBot(msg.chat.id, msg.text.replace(/[^0-9]/g, ''));
    }
});

app.get('/', (req, res) => res.send("Active"));
app.listen(process.env.PORT || 10000);
