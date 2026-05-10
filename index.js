const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const P = require('pino');
const { Boom } = require("@hapi/boom");

// توكن البوت الخاص بك
const TELEGRAM_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new Telegraf(TELEGRAM_TOKEN);

/**
 * وظيفة طلب كود الربط
 */
async function requestWhatsAppCode(chatId, phoneNumber) {
    // استخدام مجلد مؤقت متوافق مع Render لضمان الصلاحيات
    const sessionPath = `/tmp/session_${chatId}_${Date.now()}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"], // ضروري لعمل الكود
    });

    sock.ev.on('creds.update', saveCreds);

    try {
        // تأخير بسيط لضمان تهيئة الاتصال
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        let code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
        
        await bot.telegram.sendMessage(chatId, 
            `✅ *تم استخراج كود الربط بنجاح*\n\n` +
            `🔢 الكود: \`${code}\`\n\n` +
            `الآن افتح واتساب > الأجهزة المرتبطة > ربط برقم الهاتف وأدخل الكود.`, 
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error("Pairing Error:", error);
        await bot.telegram.sendMessage(chatId, `❌ فشل طلب الكود. تأكد من أن الرقم صحيح ويحتوي على مفتاح الدولة.`);
    }

    // إغلاق الاتصال بعد استخراج الكود لتوفير الموارد على Render
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log("Device Logged Out");
            }
        } else if (connection === 'open') {
            bot.telegram.sendMessage(chatId, `🎉 تم ربط واتساب بنجاح!`);
        }
    });
}

// أوامر التليجرام
bot.start((ctx) => {
    ctx.reply('مرحباً بك في نظام ربط واتساب! 🚀\n\nأرسل رقم هاتفك الآن (بصيغة دولية) للحصول على كود الربط.\nمثال: 967777777777');
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    
    if (/^\d+$/.test(text) && text.length > 8) {
        await ctx.reply('⏳ جاري الاتصال بسيرفرات واتساب لطلب الكود...');
        await requestWhatsAppCode(ctx.chat.id, text);
    } else {
        ctx.reply('❌ خطأ: يرجى إرسال أرقام فقط (مثال: 9665xxxxxxxx).');
    }
});

// تشغيل البوت ومعالجة أخطاء الشبكة
bot.launch()
    .then(() => console.log('🤖 Telegram Bot is Running...'))
    .catch((err) => console.error('❌ Failed to launch Telegram Bot:', err));

// التعامل مع إغلاق السيرفر بشكل نظيف
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
