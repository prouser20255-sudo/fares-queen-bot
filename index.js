const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    fetchLatestBaileysVersion, 
    DisconnectReason,
    Browsers,
    downloadMediaMessage 
} = require("@whiskeysockets/baileys");
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const express = require('express');
const fs = require('fs-extra');

// --- إعدادات الهوية والاتصال ---
const token = '8631941557:AAHJ_97NplwcLMkee0-Zrf2FY5XqmI6E_0I'; 
const settingsFile = './settings.json';
const app = express();
app.use(express.json());
const bot = new TelegramBot(token, { polling: true });
const sessions = new Map();

// رابط الربط الخاص بك
const PAIRING_URL = "https://fares-queen-bot.onrender.com";

// --- نظام إدارة الإعدادات المستمر ---
if (!fs.existsSync(settingsFile)) {
    fs.writeJsonSync(settingsFile, { 
        name: "GOLDEN QUEEN", 
        emoji: "👑", 
        prefix: ".", 
        mode: "public" 
    });
}

const getSettings = () => fs.readJsonSync(settingsFile);
const saveSettings = (newData) => fs.writeJsonSync(settingsFile, { ...getSettings(), ...newData });

// تأمين المجلدات
fs.ensureDirSync('./sessions');
fs.ensureDirSync('./status_downloads');

// --- واجهة التحكم الاحترافية (Dashboard) ---
app.get('/', (req, res) => {
    const config = getSettings();
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GOLDEN QUEEN | CONTROL PANEL</title>
  <style>
    :root { --bg: #020617; --panel: #0f172a; --accent: #22c55e; --gold: #d4a017; --text: #f8fafc; --muted: #94a3b8; --border: #1e293b; --danger: #ef4444; }
    body { margin: 0; font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); direction: rtl; }
    #login-screen { height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle, #1e293b, #020617); }
    .login-box { background: var(--panel); padding: 40px; border-radius: 24px; border: 1px solid var(--border); width: 90%; max-width: 400px; text-align: center; box-shadow: 0 0 20px rgba(212,160,23,0.2); }
    #dashboard { display: none; padding: 20px; max-width: 1200px; margin: 0 auto; }
    .card { background: var(--panel); padding: 25px; border-radius: 20px; border: 1px solid var(--border); margin-bottom: 20px; }
    .btn { padding: 12px; border-radius: 10px; border: none; font-weight: bold; cursor: pointer; width: 100%; transition: 0.3s; margin-top: 10px; }
    .btn-gold { background: linear-gradient(45deg, var(--gold), #f9d976); color: #000; }
    input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 10px; border: 1px solid var(--border); background: #020617; color: white; text-align: center; outline: none; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .cmd-btn { background: #1e293b; color: white; border: 1px solid var(--border); padding: 10px; border-radius: 8px; cursor: pointer; margin: 5px; flex: 1; font-size: 14px; }
    .cmd-btn:hover { background: var(--gold); color: black; }
    .pairing-link { display: block; margin-top: 15px; color: var(--gold); text-decoration: none; font-size: 13px; opacity: 0.8; }
  </style>
</head>
<body>
  <div id="login-screen">
    <div class="login-box">
      <h2 style="color:var(--gold)">GOLDEN QUEEN</h2>
      <p style="color:var(--muted)">لوحة تحكم النظام</p>
      <input type="password" id="admin-pass" placeholder="رمز الدخول">
      <button class="btn btn-gold" onclick="login()">دخول النظام</button>
      <a href="${PAIRING_URL}" class="pairing-link" target="_blank">رابط الاقتران: ${PAIRING_URL}</a>
    </div>
  </div>

  <div id="dashboard">
    <div class="card">
      <h1 style="margin:0; color:var(--gold)">الملكة الذهبية <span style="font-size:12px; color:var(--accent)">متصل ونشط ✅</span></h1>
      <small style="color:var(--muted)">رابط السيرفر: ${PAIRING_URL}</small>
    </div>

    <div class="grid">
      <div class="card">
        <h3>⚙️ إعدادات البوت</h3>
        <label>اسم النظام</label><input type="text" id="bot-name" value="${config.name}">
        <label>إيموجي التفاعل</label><input type="text" id="bot-emoji" value="${config.emoji}">
        <button class="btn btn-gold" onclick="updateData()">حفظ التغييرات</button>
      </div>

      <div class="card">
        <h3>🚀 التحكم السريع</h3>
        <div style="display:flex; flex-wrap: wrap;">
          <button class="cmd-btn" onclick="runCmd('mode_public')">وضع عام</button>
          <button class="cmd-btn" onclick="runCmd('mode_self')">وضع خاص</button>
          <button class="cmd-btn" onclick="runCmd('restart')" style="color:var(--danger)">إعادة تشغيل</button>
        </div>
        <hr style="border: 0.5px solid var(--border); margin: 20px 0;">
        <input type="text" id="bc-msg" placeholder="رسالة جماعية...">
        <button class="btn" style="background:var(--accent); color:white;" onclick="runCmd('broadcast')">إرسال برودكاست</button>
      </div>
    </div>
  </div>

  <script>
    function login() {
      if(document.getElementById('admin-pass').value === "1234") {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
      } else { alert("الرمز غير صحيح!"); }
    }

    async function updateData() {
      const payload = { name: document.getElementById('bot-name').value, emoji: document.getElementById('bot-emoji').value };
      await fetch('/api/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      alert("تم تحديث البيانات بنجاح ✅");
    }

    async function runCmd(cmd) {
      const val = document.getElementById('bc-msg').value;
      await fetch('/api/command', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({command: cmd, text: val}) });
      alert("تم إرسال الأمر: " + cmd);
    }
  </script>
</body>
</html>
    `);
});

// --- واجهة برمجة التطبيقات (API) ---
app.post('/api/update', (req, res) => {
    saveSettings({ name: req.body.name, emoji: req.body.emoji });
    res.json({ status: "ok" });
});

app.post('/api/command', (req, res) => {
    const { command } = req.body;
    if (command === 'restart') process.exit();
    if (command === 'mode_public') saveSettings({ mode: 'public' });
    if (command === 'mode_self') saveSettings({ mode: 'self' });
    res.json({ status: "done" });
});

app.listen(process.env.PORT || 10000);

// --- محرك واتساب (نسخة حل مشكلة التعليق) ---
async function startBot(chatId, phone) {
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${chatId}`);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu("Chrome"), 
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000 
    });

    sessions.set(chatId, sock);

    if (!sock.authState.creds.registered) {
        await delay(3000);
        try {
            const code = await sock.requestPairingCode(phone);
            bot.sendMessage(chatId, `✅ تم توليد كود الربط لسيرفر Render:\n\n\`${code}\`\n\nقم بإدخاله في واتساب الآن.`, { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(chatId, "❌ خطأ في طلب الكود، حاول مجدداً.");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') bot.sendMessage(chatId, "🔓 تم الاتصال بنجاح! تحكم عبر اللوحة الآن:\n" + PAIRING_URL);
        if (connection === 'close') {
            const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (reconnect) startBot(chatId, phone);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const isMe = m.key.fromMe;
        const remoteJid = m.key.remoteJid;
        const msgText = m.message.conversation || m.message.extendedTextMessage?.text || "";
        const config = getSettings();

        if (isMe) {
            if (msgText === 'اوامر') {
                const menu = `👑 *نظام ${config.name}*\n\n🔹 الايموجي: ${config.emoji}\n🔹 الوضع: ${config.mode}\n🔹 الرابط: ${PAIRING_URL}\n\n*الأوامر:* \n.تغيير [إيموجي]\n.تحديث\n.حالة`;
                await sock.sendMessage(remoteJid, { text: menu });
            }
            if (msgText.startsWith('.تغيير ')) {
                const newEmoji = msgText.split(' ')[1];
                saveSettings({ emoji: newEmoji });
                await sock.sendMessage(remoteJid, { text: "✅ تم التحديث!" });
            }
        }

        if (!isMe && remoteJid === 'status@broadcast') {
            await sock.readMessages([m.key]);
            await sock.sendMessage('status@broadcast', { react: { key: m.key, text: config.emoji } }, { statusJidList: [m.key.participant] });
        }
    });
}

bot.on('message', (msg) => {
    if (/[0-9]{10,}/.test(msg.text)) startBot(msg.chat.id, msg.text.replace(/[^0-9]/g, ''));
});

// معالجة الأخطاء لضمان استمرارية العمل 24 ساعة
process.on('uncaughtException', (err) => console.log('Recovered error:', err));
process.on('unhandledRejection', (err) => console.log('Recovered rejection:', err));
