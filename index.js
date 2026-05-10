
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const pino = require('pino');
const express = require('express');
const fs = require('fs-extra');
const app = express();

// إعدادات البوت
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I'; 
const PORT = process.env.PORT || 10000;

const bot = new Telegraf(TG_TOKEN);

// سيرفر للبقاء حياً وتجاوز نظام Render
app.get('/', (req, res) => res.send('Fares Queen Bot is Live! ✅'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));

async function startWhatsApp(chatId, phoneNumber) {
    const sessionPath = `./sessions/${chatId}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    try {
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.creds.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            // استخدام هوية متصفح مستقرة جداً لضمان وصول الإشعار
            browser: Browsers.ubuntu("Chrome"),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            // انتظار بسيط لضمان استقرار السيرفر قبل طلب الكود
            await delay(8000);
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                await bot.telegram.sendMessage(chatId, `✅ **تم توليد كود الاقتران بنجاح:**\n\n🔢 الكود: \`${code}\`\n\nقم بفتح واتساب > الأجهزة المرتبطة > ربط برقم الهاتف وأدخل الكود.`, { parse_mode: 'Markdown' });
            } catch (err) {
                await bot.telegram.sendMessage(chatId, "❌ فشل طلب الكود حالياً، يرجى المحاولة بعد دقائق.");
            }
        }

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    // إعادة تشغيل ذكية عند الانقطاع
                    setTimeout(() => startWhatsApp(chatId, phoneNumber), 5000);
                }
            } else if (connection === 'open') {
                await bot.telegram.sendMessage(chatId, "🎊 تم ربط الواتساب بنجاح! البوت سيعمل الآن 24 ساعة.");
            }
        });

        sock.ev.on('messages.upsert', async (chatUpdate) => {
            const msg = chatUpdate.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            if (msg.key.remoteJid === 'status@broadcast') {
                const participant = msg.key.participant;
                await sock.readMessages([msg.key]);
                await sock.sendMessage('status@broadcast', {
                    react: { text: '💚', key: msg.key }
                }, { statusJidList: [participant] });
            }
        });

    } catch (e) {
        console.error("WhatsApp Error: ", e);
    }
}

bot.start((ctx) => {
    ctx.reply(`👑 أهلاً بك في نظام الملكة الذهبية\nأرسل رقمك الآن مع مفتاح الدولة (967xxxxxxxxx) للربط.`);
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text)) {
        ctx.reply("⏳ جاري تهيئة الطلب.. انتظر وصول الكود.");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("❌ يرجى إرسال رقم هاتف صحيح فقط.");
    }
});

// تشغيل البوت ومعالجة الأخطاء العالمية لمنع توقف السيرفر
bot.launch().then(() => console.log("Telegram Bot Started..."));

process.on('uncaughtException', (err) => console.error('Ignored Error:', err));
process.on('unhandledRejection', (err) => console.error('Ignored Rejection:', err));
