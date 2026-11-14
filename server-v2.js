require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");
const RAGEngine = require("./lib/rag");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Inisialisasi Groq SDK
let groq = null;
if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "gsk_isi_api_key_groq_kamu_disini") {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// Inisialisasi RAG Engine
const ragEngine = new RAGEngine(path.join(__dirname, "data/products.csv"));

// Load Knowledge Base
const KNOWLEDGE_PATH = path.join(__dirname, "knowledge.json");
let knowledge = { keywords: {}, responses: {} };
function loadKnowledge() {
    try {
        if (fs.existsSync(KNOWLEDGE_PATH)) {
            knowledge = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, "utf-8"));
        }
    } catch (err) {
        console.error("Gagal membaca knowledge.json:", err);
    }
}
loadKnowledge();

// State WhatsApp Bot
let client = null;
let qrCodeData = null;
let isReady = false;
let isInitializing = false;
let isCleaning = false;

// ================= KUOTA & RATE LIMIT GROQ AI =================
let groqQuota = {
    model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
    remainingRequests: null,
    limitRequests: null,
    remainingTokens: null,
    limitTokens: null,
    resetRequests: null,
    lastChecked: null,
    configured: Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "gsk_isi_api_key_groq_kamu_disini")
};

function updateGroqQuotaFromHeaders(headers, modelName) {
    if (!headers) return;
    groqQuota.model = modelName || process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
    const remReq = headers.get ? headers.get("x-ratelimit-remaining-requests") : headers["x-ratelimit-remaining-requests"];
    const limReq = headers.get ? headers.get("x-ratelimit-limit-requests") : headers["x-ratelimit-limit-requests"];
    const remTok = headers.get ? headers.get("x-ratelimit-remaining-tokens") : headers["x-ratelimit-remaining-tokens"];
    const limTok = headers.get ? headers.get("x-ratelimit-limit-tokens") : headers["x-ratelimit-limit-tokens"];
    const rstReq = headers.get ? headers.get("x-ratelimit-reset-requests") : headers["x-ratelimit-reset-requests"];

    if (remReq) groqQuota.remainingRequests = Number(remReq);
    if (limReq) groqQuota.limitRequests = Number(limReq);
    if (remTok) groqQuota.remainingTokens = Number(remTok);
    if (limTok) groqQuota.limitTokens = Number(limTok);
    if (rstReq) groqQuota.resetRequests = rstReq;
    groqQuota.lastChecked = new Date().toLocaleTimeString("id-ID");
    groqQuota.configured = true;
}

async function fetchGroqQuotaFresh() {
    if (!groq) {
        if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "gsk_isi_api_key_groq_kamu_disini") {
            groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        } else {
            return groqQuota;
        }
    }

    const modelToUse = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
    try {
        const { response } = await groq.chat.completions.create({
            model: modelToUse,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1
        }).withResponse();

        updateGroqQuotaFromHeaders(response.headers, modelToUse);
    } catch (err) {
        console.warn("Gagal mengecek kuota Groq:", err.message);
    }
    return groqQuota;
}

// ================= CONVERSATION HISTORY (MULTI-TURN MEMORY) =================
const conversationHistory = new Map();
const MAX_HISTORY_MESSAGES = 6;
const SESSION_TTL_MS = 20 * 60 * 1000;

function getUserHistory(senderId) {
    if (!senderId) return [];
    const session = conversationHistory.get(senderId);
    const now = Date.now();

    if (!session) return [];

    if (now - session.lastActive > SESSION_TTL_MS) {
        conversationHistory.delete(senderId);
        return [];
    }

    return session.messages || [];
}

function appendUserHistory(senderId, userMsg, botReply) {
    if (!senderId) return;
    const now = Date.now();
    let session = conversationHistory.get(senderId);

    if (!session || (now - session.lastActive > SESSION_TTL_MS)) {
        session = { messages: [], lastActive: now };
    }

    session.messages.push({ role: "user", content: userMsg });
    session.messages.push({ role: "assistant", content: botReply });

    if (session.messages.length > MAX_HISTORY_MESSAGES) {
        session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
    }

    session.lastActive = now;
    conversationHistory.set(senderId, session);
}

// Deteksi otomatis lokasi Chrome atau Edge di Windows
function findBrowserPath() {
    const possiblePaths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    ];
    return possiblePaths.find(p => p && fs.existsSync(p));
}

function initializeClient() {
    if (client) return client;

    const executablePath = findBrowserPath();
    if (!executablePath) {
        throw new Error("Browser Google Chrome / Microsoft Edge tidak ditemukan di Windows.");
    }

    client = new Client({
        authStrategy: new LocalAuth({
            clientId: "chatbot-rag"
        }),
        puppeteer: {
            executablePath,
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]
        }
    });

    client.on("qr", qr => {
        qrCodeData = qr;
        isInitializing = false;
        console.log("\n================ KODE QR WHATSAPP ================");
        qrcode.generate(qr, { small: true });
        console.log("Pindai QR code di atas atau melalui web dashboard.");
        console.log("==================================================\n");
    });

    client.on("authenticated", () => {
        console.log("Autentikasi WhatsApp berhasil.");
    });

    client.on("auth_failure", msg => {
        console.error("Autentikasi WhatsApp gagal:", msg);
        isInitializing = false;
    });

    client.on("ready", () => {
        isReady = true;
        isInitializing = false;
        qrCodeData = null;
        console.log("Bot WhatsApp siap digunakan");
    });

    client.on("disconnected", reason => {
        console.log("WhatsApp terputus:", reason);
        isReady = false;
        qrCodeData = null;
        client = null;
    });

    client.on("message", async msg => {
        try {
            if (msg.fromMe || !msg.body) return;

            const isPersonalChat =
                msg.from.endsWith("@c.us") ||
                msg.from.endsWith("@lid");
            const isNotStatus = !msg.from.endsWith("@status");

            if (!isPersonalChat || !isNotStatus) {
                console.log("Pesan grup/status diabaikan:", msg.from);
                return;
            }

            const message = msg.body.trim();
            console.log(`[Pesan Masuk dari ${msg.from}]: ${message}`);

            const reply = await getAIResponse(msg.from, message);
            await msg.reply(reply);
            console.log(`[Balasan Terkirim]: ${reply}`);
        } catch (err) {
            console.error("Error memproses pesan:", err);
            try {
                await msg.reply("Mohon maaf, saat ini sistem asisten sedang mengalami gangguan teknis. Silakan coba kembali sesaat lagi.");
            } catch (replyErr) {
                console.error("Gagal mengirim pesan error fallback:", replyErr);
            }
        }
    });

    return client;
}

function formatWhatsAppMessage(text) {
    if (!text) return "";
    let formatted = text.replace(/\*\*(.*?)\*\*/g, "*$1*");
    formatted = formatted.replace(/\n{3,}/g, "\n\n").trim();
    return formatted;
}

function isGreetingMessage(text) {
    if (!text) return false;
    const q = text.toLowerCase().trim();
    const greetings = [
        "halo", "hai", "hi", "hey", "hello", "hei", "p", "ping", "test",
        "pagi", "selamat pagi", "siang", "selamat siang", "sore", "selamat sore",
        "malam", "selamat malam", "assalamualaikum", "assalamu'alaikum",
        "assalamu alaikum", "permisi", "sampurasun"
    ];
    if (greetings.includes(q)) return true;

    if (/^(halo|hai|hi|hey|hello|selamat\s+(pagi|siang|sore|malam)|assalamu\s*alaikum|permisi)\b/i.test(q)) {
        const productKeywords = [
            "produk", "harga", "katalog", "jual", "beli", "hp", "handphone", "galaxy",
            "tv", "kulkas", "mesin cuci", "watch", "smartwatch", "tab", "tablet",
            "buds", "soundbar", "ac", "case", "fold", "flip"
        ];
        return !productKeywords.some(pk => q.includes(pk));
    }
    return false;
}

function isGratitudeMessage(text) {
    if (!text) return false;
    const q = text.toLowerCase().trim();
    const gratitudeList = [
        "terima kasih", "terimakasih", "makasih", "makasi", "thx", "thanks", "thank you",
        "matur nuwun", "nuhun", "syukron", "terima kasih banyak", "terimakasih banyak", "makasih banyak"
    ];
    if (gratitudeList.includes(q)) return true;

    return /^(terima\s*kasih|makasih|makasi|thanks|thank\s*you|thx|matur\s*nuwun|nuhun|syukron)\b/i.test(q);
}

async function getAIResponse(senderId, message) {
    const normalized = message.toLowerCase().trim();

    // 1. Template Sistem Cepat: Sapaan Awal
    if (isGreetingMessage(normalized)) {
        console.log("[Template Sapaan]: Menggunakan template sistem cepat (tanpa panggil AI)");
        const greetingReply = "Halo! Selamat datang di *Samsung Official Shop*. ✨\n\nAda produk Samsung (Smartphone Galaxy, Tab, Watch, TV, Kulkas, Mesin Cuci, atau Audio) yang sedang Anda cari hari ini? 😊";
        if (senderId) appendUserHistory(senderId, message, greetingReply);
        return greetingReply;
    }

    // 2. Template Sistem Cepat: Ucapan Terima Kasih
    if (isGratitudeMessage(normalized)) {
        console.log("[Template Terima Kasih]: Menggunakan template sistem cepat (tanpa panggil AI)");
        const gratitudeReply = "Sama-sama! Senang bisa membantu Anda di *Samsung Official Shop*. ✨\n\nJika ada pertanyaan lain seputar spesifikasi, harga, atau link pembelian produk, silakan chat kembali ya! 😊";
        if (senderId) appendUserHistory(senderId, message, gratitudeReply);
        return gratitudeReply;
    }

    // 3. Cek respons manual langsung dari knowledge.json
    if (knowledge.responses && knowledge.responses[normalized]) {
        console.log("[Knowledge Match]: Menggunakan jawaban manual keyword");
        const manualReply = formatWhatsAppMessage(knowledge.responses[normalized]);
        if (senderId) appendUserHistory(senderId, message, manualReply);
        return manualReply;
    }

    // 4. Cek keyword alias di knowledge.keywords
    if (knowledge.keywords) {
        for (const [kw, targetKey] of Object.entries(knowledge.keywords)) {
            if (normalized.includes(kw.toLowerCase())) {
                if (knowledge.responses && knowledge.responses[targetKey]) {
                    console.log(`[Knowledge Keyword Match]: Cocok dengan keyword '${kw}'`);
                    const manualReply = formatWhatsAppMessage(knowledge.responses[targetKey]);
                    if (senderId) appendUserHistory(senderId, message, manualReply);
                    return manualReply;
                }
            }
        }
    }

    // 5. Ambil riwayat percakapan
    const history = senderId ? getUserHistory(senderId) : [];

    // 6. RAG Context dari CSV produk Samsung
    let ragContext = ragEngine.buildContext(message);

    if (!ragContext && history.length > 0) {
        const prevUserQueries = history
            .filter(h => h.role === "user")
            .slice(-2)
            .map(h => h.content)
            .join(" ");
        ragContext = ragEngine.buildContext(`${prevUserQueries} ${message}`);
    }

    // 7. Panggil Groq AI
    try {
        if (!groq) {
            if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "gsk_isi_api_key_groq_kamu_disini") {
                groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
            } else {
                return "Halo! Terima kasih telah menghubungi kami. Saat ini sistem sedang dalam mode offline atau API Key Groq belum dikonfigurasi pada file .env.";
            }
        }

        const systemPrompt = `Anda adalah konsultan produk resmi dari "Samsung Official Shop", toko resmi produk elektronik dan gadget Samsung di Shopee. Jawab dalam Bahasa Indonesia yang ramah, profesional, informatif, to the point, dan sangat rapi.

PRINSIP KEAKURATAN DATA PRODUK (BERPIJAK KETAT PADA KATALOG RESMI):
1. Keaslian & Kebenaran Data:
   - Jawab HANYA berdasarkan informasi produk resmi yang tertera pada Konteks Katalog di bawah (nama produk, varian RAM/ROM atau ukuran, warna, harga Rupiah, rating/penjualan, dan Link Shopee).
   - JANGAN PERNAH mengarang, menebak harga, atau menyebutkan produk Samsung lain yang tidak tercantum di Konteks Katalog.
   - SELALU sertakan *Link Shopee* asli produk yang bersangkutan dari Konteks Katalog apabila pelanggan menanyakan detail produk, harga, atau rekomendasi pembelian.
2. Jangan Pernah Memecah Karakter (No Fourth-Wall Breaking):
   - JANGAN PERNAH menyebut istilah internal seperti "di file CSV", "hasil scraping", "di database", atau "konteks katalog".
   - Tampil selayaknya konsultan resmi Samsung Official Shop yang menguasai seluruh katalog tokonya.
3. Jawab Ringkas & To-The-Point:
   - Jawab pertanyaan pelanggan secara langsung dan padat.
   - Jika produk atau spesifikasi yang dicari tidak tersedia di katalog, sampaikan dengan sopan dan arahkan pelanggan untuk mengecek langsung etalase resmi toko kami:
     🛒 *Toko Shopee:* https://shopee.co.id/samsung.official
     ⏰ *Jam Layanan:* Setiap Hari (09.00 - 21.00 WIB)

ATURAN SALAM & KATA "SELAMAT DATANG":
- HANYA ucapkan "Selamat datang di Samsung Official Shop" jika pesan pelanggan berupa salam awal tanpa riwayat obrolan sebelumnya.
- Jika pelanggan langsung menanyakan produk/harga atau sedang dalam percakapan lanjutan, langsung jawab inti pertanyaannya tanpa mengulang salam pembuka.
- DILARANG menggunakan frasa kaku seperti "Saya adalah bot virtual" atau "Saya asisten AI".

PANDUAN FORMAT TAMPILAN WHATSAPP:
1. Gunakan SATU bintang untuk cetak tebal, contoh: *Nama Produk* (JANGAN gunakan dua bintang **teks**).
2. Gunakan bullet point (•) untuk setiap item produk dan pisahkan tiap produk dengan baris baru agar mudah dibaca di layar HP.
3. Format tiap item produk secara rapi:
   • *Nama Produk*
     Harga: Rp X.XXX.XXX
     Info: (detail singkat seperti rating/terjual/diskon)
     Link: (URL Shopee dari katalog)

${ragContext ? ragContext : "Konteks Katalog: (Tidak ada produk yang cocok ditemukan untuk kata kunci ini. Jika pelanggan hanya menyapa, balas sapaan dengan ramah. Jika menanyakan produk yang tidak tersedia, arahkan ke https://shopee.co.id/samsung.official)."}`;

        const messagesPayload = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
        ];

        const candidateModels = [
            process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
            "openai/gpt-oss-20b",
            "allam-2-7b"
        ];

        let lastError = null;
        for (const modelName of candidateModels) {
            try {
                const { data: completion, response } = await groq.chat.completions.create({
                    model: modelName,
                    messages: messagesPayload,
                    max_tokens: Number(process.env.GROQ_MAX_TOKENS || 1500)
                }).withResponse();

                if (response && response.headers) {
                    updateGroqQuotaFromHeaders(response.headers, modelName);
                }

                if (completion.choices && completion.choices[0] && completion.choices[0].message) {
                    const rawAiReply = completion.choices[0].message.content;
                    const aiReply = formatWhatsAppMessage(rawAiReply);
                    if (senderId) {
                        appendUserHistory(senderId, message, aiReply);
                    }
                    return aiReply;
                }
            } catch (err) {
                lastError = err;
                console.warn(`[Groq Model ${modelName}] Gagal: ${err.message}. Mencoba model alternatif...`);
            }
        }

        throw lastError || new Error("Semua model Groq gagal merespon.");
    } catch (error) {
        console.error("Error Groq API:", error.message || error);
        if (ragContext) {
            return formatWhatsAppMessage(`Halo! ✨ Berikut informasi produk dari katalog *Samsung Official Shop*:\n\n${ragContext}\n\nAda yang bisa kami bantu seputar produk di atas? 😊`);
        }
        return formatWhatsAppMessage(`Halo! ✨ Terima kasih telah menghubungi *Samsung Official Shop*.\n\nKami menyediakan berbagai produk resmi Samsung seperti *Smartphone Galaxy*, *Tablet*, *Smartwatch*, *TV*, *Kulkas*, *Mesin Cuci*, dan *Audio*.\n\nSilakan sebutkan produk yang sedang Anda cari! 😊`);
    }
}

function maskPhoneNumber(rawNumber) {
    if (!rawNumber) return null;
    let formatted = String(rawNumber).replace(/^62/, "08");
    if (formatted.length >= 8) {
        const prefix = formatted.slice(0, 2);
        const suffix = formatted.slice(-4);
        const maskedLength = formatted.length - 6;
        return `${prefix}${"x".repeat(maskedLength)}${suffix}`;
    }
    return formatted;
}

// ================= API ENDPOINTS =================

app.get("/api/bot/status", (req, res) => {
    let botNumber = null;
    if (isReady && client && client.info && client.info.wid) {
        botNumber = maskPhoneNumber(client.info.wid.user);
    }

    res.json({
        isReady,
        isInitializing,
        isCleaning,
        hasQRCode: Boolean(qrCodeData),
        botNumber
    });
});

app.get("/api/groq/quota", async (req, res) => {
    try {
        const isFresh = req.query.fresh === "true" || groqQuota.remainingRequests === null;
        if (isFresh) {
            await fetchGroqQuotaFresh();
        }
        res.json(groqQuota);
    } catch (err) {
        console.error("Error cek kuota Groq:", err);
        res.status(500).json({ error: err.message, ...groqQuota });
    }
});

app.get("/api/bot/qr", (req, res) => {
    res.json({ qr: qrCodeData });
});

app.post("/api/bot/start", async (req, res) => {
    try {
        if (isReady) {
            return res.json({ success: true, message: "Bot sudah berjalan." });
        }
        if (isInitializing) {
            return res.json({ success: true, message: "Bot sedang proses inisialisasi..." });
        }

        isInitializing = true;
        const waClient = initializeClient();
        await waClient.initialize();
        res.json({ success: true });
    } catch (err) {
        isInitializing = false;
        console.error("Gagal memulai bot:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/api/bot/stop", async (req, res) => {
    try {
        isCleaning = true;
        isReady = false;
        qrCodeData = null;
        if (client) {
            await client.destroy();
        }
        client = null;
        isCleaning = false;
        res.json({ success: true });
    } catch (err) {
        isCleaning = false;
        console.error("Gagal menghentikan bot:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/api/bot/reset", async (req, res) => {
    try {
        isCleaning = true;
        isReady = false;
        isInitializing = false;
        qrCodeData = null;

        if (client) {
            try {
                await client.destroy();
            } catch (e) {
                console.warn("Peringatan saat destroy client:", e.message);
            }
            client = null;
        }

        const authDir = path.join(__dirname, ".wwebjs_auth");
        const cacheDir = path.join(__dirname, ".wwebjs_cache");

        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log("[Reset Session]: Folder .wwebjs_auth berhasil dihapus");
        }
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.log("[Reset Session]: Folder .wwebjs_cache berhasil dihapus");
        }

        conversationHistory.clear();
        console.log("[Reset Session]: Seluruh riwayat obrolan berhasil dibersihkan");

        isCleaning = false;
        res.json({ success: true, message: "Sesi WhatsApp berhasil dibersihkan. Anda dapat memindai QR baru." });
    } catch (err) {
        isCleaning = false;
        console.error("Gagal mereset sesi bot:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/api/knowledge", (req, res) => {
    loadKnowledge();
    res.json(knowledge);
});

app.get("/api/products", (req, res) => {
    ragEngine.loadData();
    res.json({ products: ragEngine.products });
});

const server = app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    if (process.env.AUTO_START_BOT === "true") {
        console.log("AUTO_START_BOT aktif, memulai inisialisasi bot WhatsApp...");
        isInitializing = true;
        const waClient = initializeClient();
        waClient.initialize().catch(err => {
            isInitializing = false;
            console.error("Auto start gagal:", err);
        });
    }
});

async function gracefulShutdown(signal) {
    console.log(`\nMenerima sinyal ${signal}, membersihkan proses...`);
    if (client) {
        try {
            await client.destroy();
            console.log("Koneksi WhatsApp & browser Chrome berhasil ditutup.");
        } catch (e) {
            // Abaikan jika sudah tertutup
        }
    }
    server.close(() => {
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));