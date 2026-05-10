const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const P = require('pino');
const fs = require('fs');

// توكن بوت التليجرام الخاص بك
const bot = new Telegraf('8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I');

/**
 * دالة إنشاء اتصال واتساب جديد لكل طلب ربط
 * تتيح لأي مستخدم الربط أكثر من مرة
 */
async function getPairingCode(chatId, phoneNumber) {
    // إنشاء مجلد جلسة مؤقت لكل عملية ربط بناءً على أيد التليجرام والوقت
    const sessionDir = `./sessions/${chatId}_${Date.now()}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    try {
        // طلب كود الربط من سيرفرات واتساب
        let code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
        await bot.telegram.sendMessage(chatId, `✅ *تم استخراج كود الربط بنجاح*\n\nالكود هو: \`${code}\`\n\nقم بنسخ الكود وضعه في واتساب (الأجهزة المرتبطة > ربط برقم الهاتف).`, { parse_mode: 'Markdown' });
    } catch (error) {
        await bot.telegram.sendMessage(chatId, `❌ حدث خطأ أثناء طلب الكود. تأكد من صحة الرقم (مثال: 9677xxxxxxx)`);
        console.error(error);
    }

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            await bot.telegram.sendMessage(chatId, `🎉 تم ربط رقمك (${phoneNumber}) بنجاح الآن!`);
            // ملاحظة: هنا البوت يعمل، يمكنك إضافة منطق تخزين الجلسة الدائم هنا
        }
    });
}

// واجهة بوت التليجرام
bot.start((ctx) => ctx.reply('مرحباً بك في بوت ربط واتساب سريعة! 🚀\n\nأرسل رقم هاتفك مع مفتاح الدولة الآن للحصول على كود الربط.\nمثال: 967777777777'));

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    
    // التحقق إذا كان النص عبارة عن رقم هاتف
    if (/^\d+$/.test(text) && text.length > 8) {
        ctx.reply('⏳ جاري طلب كود الربط من واتساب... انتظر لحظة.');
        await getPairingCode(ctx.chat.id, text);
    } else {
        ctx.reply('❌ يرجى إرسال رقم هاتف صحيح فقط (أرقام فقط بدون + أو فواصل).');
    }
});

bot.launch().then(() => console.log('🤖 بوت التليجرام يعمل الآن...'));

// تعامل مع إغلاق البرنامج
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
