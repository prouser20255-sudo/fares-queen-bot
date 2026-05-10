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

// --- الإعدادات ---
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I'; // توكن التليجرام الخاص بك
const app = express();
const bot = new TelegramBot(token, { polling: true });
const SESSIONS_DIR = './sessions';

app.use(express.json());
fs.ensureDirSync(SESSIONS_DIR);

// --- واجهة الموقع (HTML) لتبدو تماماً مثل الرابط المطلوب ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GOLDEN QUEEN | لوحة التحكم</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
            body { background: #0f172a; color: white; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
            .card { background: #1e293b; border: 1px solid #334155; color: white; border-radius: 15px; }
            .btn-primary { background: #3b82f6; border: none; }
            .status-online { color: #10b981; }
            .navbar { background: #1e293b !important; border-bottom: 1px solid #334155; }
        </style>
    </head>
    <body>
        <nav class="navbar navbar-dark mb-4">
            <div class="container">
                <span class="navbar-brand mb-0 h1">👑 GOLDEN QUEEN DASHBOARD</span>
            </div>
        </nav>
        <div class="container">
            <div class="row">
                <div class="col-md-4 mb-4">
                    <div class="card p-4 shadow-lg">
                        <h4>حالة البوت</h4>
                        <p id="status">جاري التحقق... <span class="status-online">●</span></p>
                        <hr>
                        <button class="btn btn-danger w-100 mb-2">إعادة تشغيل</button>
                    </div>
                </div>
                <div class="col-md-8">
                    <div class="card p-4 shadow-lg">
                        <h4>الإعدادات العامة</h4>
                        <div class="mb-3">
                            <label class="form-label">إيموجي التفاعل</label>
                            <input type="text" class="form-control bg-dark text-white border-secondary" value="👑">
                        </div>
                        <div class="form-check form-switch mb-3">
                            <input class="form-check-input" type="checkbox" checked>
                            <label class="form-check-label">مشاهدة الحالات تلقائياً</label>
                        </div>
                        <button class="btn btn-primary">حفظ الإعدادات</button>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    `);
});

// --- محرك الواتساب (الإصدار المستقر) ---
async function startBot(chatId, phone) {
    const sessionDir = path.join(SESSIONS_DIR, String(chatId));
    
    // تنظيف الجلسة قبل البدء لتجنب أخطاء الربط
    if (fs.existsSync(sessionDir) && !fs.existsSync(path.join(sessionDir, 'creds.json'))) {
        fs.removeSync(sessionDir);
    }
    fs.ensureDirSync(sessionDir);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false,
    });

    if (!sock.authState.creds.registered) {
        await delay(5000);
        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ كود الربط الخاص بك هو:\n\n\`${code}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(chatId, "❌ فشل طلب الكود. يرجى المحاولة لاحقاً.");
        }
    }

    sock.ev.on('creds.update', saveCreds);
    // باقي العمليات (مشاهدة الحالات، الردود...)
}

// استلام الرقم من التليجرام
bot.on('message', async (msg) => {
    if (msg.text && /^[0-9]{10,}$/.test(msg.text.replace('+', ''))) {
        bot.sendMessage(msg.chat.id, "⏳ جاري محاولة إنشاء الكود...");
        startBot(msg.chat.id, msg.text.replace(/[^0-9]/g, ''));
    }
});

app.listen(process.env.PORT || 10000, () => {
    console.log('Server is running...');
});
