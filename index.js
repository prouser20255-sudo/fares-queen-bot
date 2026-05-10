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

app.get('/', (req, res) => res.send('System Status: Online ✅'));
app.listen(PORT, '0.0.0.0');

async function startWhatsApp(chatId, phone) {
    const sessionPath = `./sessions/${chatId}`;
    if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            // الحل السحري: تعريف الجهاز كأنه iPad لضمان وصول الإشعار وقبول الكود
            browser: ["Mac OS", "Safari", "10.15.7"], 
            syncFullHistory: false,
            connectTimeoutMs: 120000, // زيادة وقت المهلة
            defaultQueryTimeoutMs: 0
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            // انتظار 15 ثانية لتجنب رسالة "تعذر ربط الجهاز"
            await delay(15000); 
            try {
                let code = await sock.requestPairingCode(phone);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                await bot.sendMessage(chatId, `🔢 **كود الربط الجديد:**\n\n\`${code}\`\n\n⚠️ **الآن وبسرعة:**\n1️⃣ اذهب لواتساب > الأجهزة المرتبطة.\n2️⃣ اختر "ربط برقم الهاتف".\n3️⃣ أدخل الكود أعلاه.`);
            } catch (err) {
                await bot.sendMessage(chatId, "❌ واتساب يمنع الربط حالياً، جرب بعد ساعة.");
            }
        }

        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect } = u;
            if (connection === 'open') {
                await bot.sendMessage(chatId, "🔓 **تم الربط بنجاح!** البوت لن يتوقف الآن.");
            }
            if (connection === 'close') {
                if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                    startWhatsApp(chatId, phone);
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;
            if (m.key.remoteJid === 'status@broadcast') {
                await sock.readMessages([m.key]);
                await sock.sendMessage('status@broadcast', { react: { key: m.key, text: '💚' } }, { statusJidList: [m.key.participant] });
            }
        });

    } catch (e) { console.log("Critical Error: ", e); }
}

bot.on('message', (msg) => {
    if (msg.text && /^\d+$/.test(msg.text)) {
        bot.sendMessage(msg.chat.id, "⏳ جاري الطلب بهوية جديدة.. انتظر الإشعار أو اربط يدوياً.");
        startWhatsApp(msg.chat.id, msg.text);
    }
});
