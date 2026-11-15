
import Groq from "groq-sdk";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const RAGEngine = require("../lib/rag.js");

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(currentDir, "../data/products.csv");

const rag = new RAGEngine(csvPath);

// Untuk memeriksa apakah API berjalan
export function GET() {
  return Response.json({
    status: "online",
    totalProduk: rag.products.length
  });
}

// Untuk menjawab pertanyaan chatbot
export async function POST(request) {
  try {
    const { message } = await request.json();

    if (typeof message !== "string" || !message.trim()) {
      return Response.json(
        { error: "Pertanyaan tidak boleh kosong" },
        { status: 400 }
      );
    }

    const context = rag.buildContext(message);

    if (!context) {
      return Response.json({
        reply: "Maaf, saya belum menemukan informasi produk tersebut di katalog."
      });
    }

    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY belum dikonfigurasi");
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });

    const result = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `Kamu adalah asisten toko Shopee.
Jawab pertanyaan pelanggan berdasarkan data katalog.
Jangan mengarang harga, stok, atau spesifikasi.
Jika informasi tidak tersedia, katakan dengan jelas.

Katalog produk:
${context}`
        },
        {
          role: "user",
          content: message
        }
      ],
      max_tokens: 500
    });

    const reply =
      result.choices?.[0]?.message?.content ||
      "Maaf, jawaban belum tersedia.";

    return Response.json({ reply });

  } catch (error) {
    console.error("Chat API error:", error);

    return Response.json(
      { error: "Chatbot gagal memproses pertanyaan" },
      { status: 500 }
    );
  }
}
