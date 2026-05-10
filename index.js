const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const { Telegraf } = require('telegraf');
const P = require('pino');
const http = require('http');

// --- إعداد سيرفر الويب لمنع Render من إغلاق البوت ---
const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Bot is running and healthy!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// --- إعدادات البوت ---
const TELEGRAM_TOKEN = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I';
const bot = new Telegraf(TELEGRAM_TOKEN);

async function createWhatsAppSession(chatId, phoneNumber) {
    // استخدام مجلد مؤقت متوافق مع Render
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
        browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    sock.ev.on('creds.update', saveCreds);

    try {
        // ننتظر قليلاً حتى يستقر الاتصال قبل طلب الكود
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        let code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
        
        await bot.telegram.sendMessage(chatId, 
            `✅ *تم استخراج كود الربط*\n\n` +
            `🔢 الكود: \`${code}\`\n\n` +
            `قم بإدخاله في واتساب الآن.`, 
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        console.error(err);
        await bot.telegram.sendMessage(chatId, "❌ حدث خطأ أثناء طلب الكود. حاول مرة أخرى.");
    }

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') {
            bot.telegram.sendMessage(chatId, "🎉 تم ربط واتساب بنجاح!");
        }
    });
}

// --- أوامر التليجرام ---
bot.start((ctx) => {
    ctx.reply('أهلاً بك في بوت ربط واتساب! 🚀\nأرسل رقم هاتفك مع مفتاح الدولة (أرقام فقط).\nمثال: 967777777777');
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^\d+$/.test(text) && text.length > 8) {
        await ctx.reply('⏳ جاري طلب الكود من سيرفرات واتساب...');
        await createWhatsAppSession(ctx.chat.id, text);
    } else {
        ctx.reply('❌ يرجى إرسال رقم هاتف صحيح.');
    }
});

bot.launch().then(() => console.log('🤖 Telegram Bot Started!'));

// التعامل مع الإغلاق
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
