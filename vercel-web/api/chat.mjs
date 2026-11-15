
import Groq from "groq-sdk";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const RAGEngine = require("../lib/rag.js");

const dir = path.dirname(fileURLToPath(import.meta.url));
const rag = new RAGEngine(
    path.join(dir, "../data/products.csv")
);

function field(row, names) {
    const entries = Object.entries(row || {});
    for (const name of names) {
        const found = entries.find(
            ([key]) => key.trim().toLowerCase() === name
        );
        if (found && found[1] != null && String(found[1]).trim()) {
            return String(found[1]).trim();
        }
    }
    return "";
}

function productCard(row) {
    const originalUrl = field(row, [
        "link_shopee", "link", "url", "product_url",
        "contents href", "href"
    ]);

    let url = "";
    try {
        const parsed = new URL(originalUrl);
        if (
            parsed.protocol === "https:" &&
            (parsed.hostname === "shopee.co.id" ||
                parsed.hostname.endsWith(".shopee.co.id"))
        ) {
            // Hapus parameter tracking yang panjang.
            url = parsed.origin + parsed.pathname;
        }
    } catch { }

    const rawPrice = field(row, ["harga", "price"]);
    const price = /^\d+$/.test(rawPrice)
        ? new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            maximumFractionDigits: 0
        }).format(Number(rawPrice))
        : rawPrice;

    return {
        name: field(row, [
            "nama", "nama_produk", "nama produk",
            "product_name", "title", "name", "contents"
        ]),
        category: field(row, ["kategori", "category"]),
        price,
        description: field(row, ["deskripsi", "description"]),
        rating: field(row, ["rating", "penilaian"]),
        url
    };
}

const products = rag.products
    .map(productCard)
    .filter(product => product.name);

export function GET() {
    return Response.json({
        status: "online",
        totalProduk: rag.products.length
    });
}

export async function POST(request) {
    try {
        const body = await request.json();
        const message = body.message?.trim();

        if (typeof message !== "string" || !message) {
            return Response.json(
                { error: "Pertanyaan tidak boleh kosong." },
                { status: 400 }
            );
        }

        const q = message.toLowerCase();

        // 1. Sapaan: tidak memanggil Groq atau RAG
        if (/^(halo|hai|hi|hello|hei|p|ping|selamat (pagi|siang|sore|malam))[\s!?.]*$/i.test(q)) {
            return Response.json({
                reply: "Halo! Selamat datang di toko Samsung. Mau cari produk apa hari ini?",
                products: []
            });
        }

        // 2. Ucapan terima kasih
        if (/^(makasih|terima kasih|terimakasih|thanks|thank you)[\s!?.]*$/i.test(q)) {
            return Response.json({
                reply: "Sama-sama! Kalau ada produk lain yang ingin ditanyakan, silakan beri tahu saya.",
                products: []
            });
        }

        // 3. Permintaan melihat katalog
        const browsePattern =
            /\b(lihat|liat|lihatin|tampilkan|tunjukkan|katalog|daftar produk|semua produk|produk apa saja|barang apa saja|ada barang apa|jual apa)\b/i;

        if (browsePattern.test(q)) {
            const shown = products.slice(0, 6);

            return Response.json({
                reply: shown.length
                    ? `Ada ${products.length} produk dalam katalog. Berikut beberapa yang bisa kamu lihat:`
                    : "Katalog belum memiliki data produk.",
                products: shown
            });
        }

        // 4. Cari produk yang relevan
        const found = rag.search(message, 4);
        const context = rag.buildContext(message);

        if (!found.length || !context) {
            return Response.json({
                reply: "Saya belum menemukan produk tersebut. Coba sebutkan nama atau jenis produk yang ingin dicari.",
                products: []
            });
        }

        if (!process.env.GROQ_API_KEY) {
            return Response.json(
                { error: "API Groq belum dikonfigurasi." },
                { status: 503 }
            );
        }

        // 5. Generasi jawaban dengan Groq
        const groq = new Groq({
            apiKey: process.env.GROQ_API_KEY
        });

        const completion = await groq.chat.completions.create({
            model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
            messages: [
                {
                    role: "system",
                    content: `Kamu adalah asisten toko Samsung di Shopee.

ATURAN JAWABAN:
- Gunakan bahasa Indonesia yang santai, sopan, dan natural.
- Jawab pertanyaan secara langsung dan singkat.
- Maksimal 2-3 kalimat, kecuali perlu penjelasan.
- DILARANG membuat tabel Markdown.
- DILARANG menggunakan HTML, tanda **, atau format tabel.
- Jangan menulis URL Shopee di jawaban.
- Informasi dan tautan produk akan ditampilkan terpisah oleh website.
- Jawab hanya berdasarkan data katalog yang diberikan.
- Jangan mengarang harga, spesifikasi, stok, atau kategori.
- Jika data tidak tersedia, sampaikan secara jelas.

DATA KATALOG:
${context}`
                },
                {
                    role: "user",
                    content: message
                }
            ],
            max_tokens: 350
        });

        let reply =
            completion.choices?.[0]?.message?.content?.trim() ||
            "Maaf, jawaban belum tersedia.";

        // Bersihkan format yang tidak dibutuhkan
        reply = reply
            .replace(/\*\*/g, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .trim();

        // Jika model tetap membuat tabel, gunakan kartu produk.
        if (/\|\s*-{3,}\s*\|/.test(reply)) {
            reply = "Saya menemukan beberapa produk yang sesuai dengan pencarianmu:";
        }

        return Response.json({
            reply,
            products: found.map(productCard)
                .filter(product => product.name)
                .slice(0, 4)
        });

    } catch (error) {
        console.error("Chat API:", error);

        return Response.json(
            { error: "Gagal memproses pertanyaan." },
            { status: 500 }
        );
    }
}
