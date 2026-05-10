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

const app = express();
const PORT = process.env.PORT || 10000;
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new TelegramBot(token, { polling: true });

// واجهة الويب لضمان بقاء السيرفر نشطاً على Render
app.get('/', (req, res) => res.send('<h1>Golden Queen System is Active ✅</h1>'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

async function startWhatsApp(chatId, phone) {
    const sessionPath = `./sessions/${chatId}`;
    
    // تنظيف شامل للجلسات القديمة لمنع تداخل الأكواد
    if (fs.existsSync(sessionPath)) {
        try { fs.removeSync(sessionPath); } catch (e) { console.log("Cleanup error"); }
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            // تحديث هوية المتصفح لمحاكاة واتساب ويب الرسمي بدقة (لحل مشكلة عدم وصول الإشعار)
            browser: Browsers.macOS("Chrome"), 
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            // انتظار 8 ثواني لضمان استقرار السيرفر قبل طلب الكود من واتساب
            await delay(8000);
            try {
                let code = await sock.requestPairingCode(phone);
                // تنسيق الكود ليظهر بشكل (XXXX-XXXX) لسهولة النسخ
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                const instructions = `🔢 **كود الاقتران الخاص بك:**\n\n` +
                                     `\`${code}\`\n\n` +
                                     `⚠️ **طريقة الربط الصحيحة:**\n` +
                                     `1️⃣ اذهب للواتساب > الأجهزة المرتبطة.\n` +
                                     `2️⃣ اختر "ربط جهاز" ثم اضغط "الربط برقم الهاتف بدلاً من ذلك".\n` +
                                     `3️⃣ أدخل الكود أعلاه فوراً.\n\n` +
                                     `*ملاحظة:* إذا لم يصلك إشعار، اتبع الخطوات يدوياً كما هو موضح أعلاه.`;
                
                await bot.sendMessage(chatId, instructions, { parse_mode: 'Markdown' });
            } catch (err) {
                await bot.sendMessage(chatId, "❌ واتساب رفض الطلب حالياً. يرجى الانتظار 3 دقائق والمحاولة مرة أخرى.");
            }
        }

        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect } = u;
            if (connection === 'open') {
                await bot.sendMessage(chatId, "🔓 **تم الاتصال بنجاح!**\nالبوت سيبدأ الآن بمشاهدة الحالات والتفاعل معها 24 ساعة.");
            }
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    // إعادة اتصال ذكي عند حدوث انقطاع مؤقت
                    setTimeout(() => startWhatsApp(chatId, phone), 5000);
                }
            }
        });

        // نظام التفاعل التلقائي مع الحالات (Auto-Status React)
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;
            
            // التفاعل مع الحالات (Stories)
            if (m.key.remoteJid === 'status@broadcast') {
                try {
                    await sock.readMessages([m.key]);
                    await sock.sendMessage('status@broadcast', { 
                        react: { key: m.key, text: '💚' } 
                    }, { statusJidList: [m.key.participant] });
                } catch (e) { /* تجاهل أخطاء التفاعل البسيطة */ }
            }
        });

    } catch (e) {
        console.error("Critical Error: ", e);
    }
}

// استقبال الرسائل من بوت تلجرام
bot.on('message', (msg) => {
    const text = msg.text?.trim();
    if (text && /^\d+$/.test(text)) {
        bot.sendMessage(msg.chat.id, "⏳ جاري إعداد كود الربط.. انتظر قليلاً.");
        startWhatsApp(msg.chat.id, text);
    } else if (text === '/start') {
        bot.sendMessage(msg.chat.id, "👑 أهلاً بك في نظام الملكة الذهبية.\nأرسل رقمك مع مفتاح الدولة للبدء (مثال: 96777xxxxxxx)");
    }
});

// منع توقف البوت عند حدوث خطأ غير متوقع
process.on('uncaughtException', (err) => console.log('Recovered from:', err));
process.on('unhandledRejection', (err) => console.log('Recovered from:', err));
