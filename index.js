const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات البوت والروابط
const TG_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const CHANNEL_LINK = 'https://t.me/fz_z_Z';

const bot = new Telegraf(TG_TOKEN);

// سيرفر للبقاء حياً على Render
app.get('/', (req, res) => res.send('Fares Queen Bot is Online!'));
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

/**
 * وظيفة تشغيل الواتساب لكل مستخدم
 */
async function startWhatsApp(chatId, phoneNumber) {
    const sessionPath = `./sessions/${chatId}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.creds.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // طلب كود الاقتران (Pairing Code)
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                await bot.telegram.sendMessage(chatId, 
                    `✅ *تم توليد كود الاقتران*\n\n` +
                    `🔢 الكود الخاص بك هو: \`${code}\`\n\n` +
                    `خطوات الربط:\n` +
                    `1. افتح الواتساب على هاتفك.\n` +
                    `2. الإعدادات > الأجهزة المرتبطة.\n` +
                    `3. ربط جهاز > الربط برقم الهاتف.\n` +
                    `4. أدخل الكود المذكور أعلاه.`, 
                    { parse_mode: 'Markdown' }
                );
            } catch (err) {
                await bot.telegram.sendMessage(chatId, "❌ حدث خطأ أثناء طلب الكود. تأكد من الرقم وحاول مجدداً.");
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startWhatsApp(chatId, phoneNumber);
            } else {
                await bot.telegram.sendMessage(chatId, "⚠️ تم تسجيل الخروج من الواتساب. أرسل الرقم مجدداً للربط.");
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        } else if (connection === 'open') {
            await bot.telegram.sendMessage(chatId, "🎊 مبروك! تم الاقتران بنجاح.\nالبوت الآن يتفاعل مع الحالات (Statuses) تلقائياً.");
            // إشعار مباشر على الواتساب
            await sock.sendMessage(sock.user.id, { text: `✅ تم ربط Fares Queen بنجاح!\nالقناة: ${CHANNEL_LINK}` });
        }
    });

    // التفاعل التلقائي مع الحالات
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const msg = chatUpdate.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;

        // التحقق من الحالات
        if (from === 'status@broadcast') {
            const sender = msg.key.participant;
            
            // قراءة الحالة تلقائياً
            await sock.readMessages([msg.key]);

            // التفاعل برمز (إيموجي) على الحالة لزيادة التفاعل
            await sock.sendMessage(from, {
                react: { text: '💚', key: msg.key }
            }, { statusJidList: [sender] });

            console.log(`[Status] Viewed and Reacted to: ${sender}`);
        }
    });
}

// أوامر بوت التليجرام
bot.start((ctx) => {
    ctx.reply(
        `أهلاً بك في بوت Fares Queen 👑\n\n` +
        `لربط رقمك، أرسل الرقم مع رمز الدولة مباشرة.\n` +
        `مثال: 96777xxxxxxx\n\n` +
        `تابعنا: @fz_z_Z`
    );
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    
    // التحقق إذا كان المدخل رقماً فقط
    if (/^\d+$/.test(text)) {
        await ctx.reply("⏳ جاري معالجة الطلب وتوليد كود الاقتران...");
        startWhatsApp(ctx.chat.id, text);
    } else {
        ctx.reply("❌ يرجى إرسال رقم هاتف صحيح (أرقام فقط بدون + أو فواصل).");
    }
});

bot.launch();
console.log("Telegram Bot is running...");
