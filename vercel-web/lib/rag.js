const fs = require("fs");
const path = require("path");

class RAGEngine {
  constructor(csvPath, options = {}) {
    this.csvPath = csvPath || path.join(__dirname, "../data/products.csv");
    this.topK = options.topK || Number(process.env.RAG_TOP_K || 10);
    this.products = [];
    this.loadData();
  }

  // Parser CSV aman untuk nilai bertanda kutip ("...") yang mengandung koma
  parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // Klasifikasi otomatis 9 kategori produk Samsung dari nama produk
  detectCategory(namaProduk) {
    const n = String(namaProduk || "").toLowerCase();
    if (["tv", "qled", "uhd", "mini led", "micro rgb"].some(k => n.includes(k))) return "TV";
    if (["tab", "tablet"].some(k => n.includes(k))) return "Tablet";
    if (n.includes("watch")) return "Smartwatch";
    if (["buds", "soundbar"].some(k => n.includes(k))) return "Audio";
    if (n.includes("kulkas")) return "Kulkas";
    if (["mesin cuci", "washer"].some(k => n.includes(k))) return "Mesin Cuci";
    if (/\bac\b/.test(n) || n.includes("windfree")) return "AC";
    if (n.includes("case")) return "Aksesoris";
    if (["galaxy", "hp"].some(k => n.includes(k))) return "Smartphone";
    return "Elektronik";
  }

  loadData() {
    try {
      if (!fs.existsSync(this.csvPath)) {
        console.warn(`[RAG] File CSV tidak ditemukan di: ${this.csvPath}`);
        this.products = [];
        return;
      }

      const content = fs.readFileSync(this.csvPath, "utf-8");
      const lines = content.trim().split(/\r?\n/);
      if (lines.length < 2) {
        this.products = [];
        return;
      }

      const headers = this.parseCSVLine(lines[0]).map(h => h.toLowerCase());

      this.products = lines.slice(1).map(line => {
        const cols = this.parseCSVLine(line);
        const raw = {};
        headers.forEach((h, idx) => {
          raw[h] = cols[idx] || "";
        });

        const nama = raw["nama"] || raw["whitespace-normal"] || "Produk Samsung";
        const hargaRaw = (raw["harga"] || raw["font-medium 2"] || "0").replace(/\./g, "");
        const kategori = raw["kategori"] || this.detectCategory(nama);
        const link = raw["contents href"] || "";
        const rating = raw["inline-block"] || "";
        const terjual = raw["truncate"] || "";
        const diskon = raw["h-4"] || "";
        const highlight = raw["min-w-0"] || raw["min-w-0 2"] || "";

        const deskripsiParts = [
          highlight,
          diskon ? `Diskon ${diskon}` : "",
          rating ? `Rating ${rating}` : "",
          terjual
        ].filter(Boolean);

        const deskripsi = raw["deskripsi"] || deskripsiParts.join(" | ") || "Produk Resmi Samsung";

        return {
          nama,
          kategori,
          harga: hargaRaw,
          deskripsi,
          link
        };
      });

      console.log(`[RAG] Berhasil memuat ${this.products.length} produk Samsung dari CSV`);
    } catch (err) {
      console.error("[RAG] Gagal memuat data CSV:", err);
      this.products = [];
    }
  }

  formatCurrency(numStr) {
    const num = Number(numStr);
    if (isNaN(num) || num === 0) return numStr;
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(num);
  }

  isGreetingQuery(query) {
    if (!query) return false;
    const q = query.toLowerCase().trim();
    const greetings = [
      "halo", "hai", "hi", "hey", "hello", "p", "ping", "test",
      "pagi", "selamat pagi", "siang", "selamat siang", "sore", "selamat sore",
      "malam", "selamat malam", "assalamualaikum", "assalamu'alaikum",
      "assalamu alaikum", "permisi"
    ];
    if (greetings.includes(q)) return true;

    if (/^(halo|hai|hi|hey|hello|selamat\s+(pagi|siang|sore|malam)|assalamu\s*alaikum)\b/i.test(q)) {
      const productKeywords = [
        "produk", "harga", "katalog", "jual", "beli", "hp", "handphone", "galaxy",
        "tv", "kulkas", "mesin cuci", "watch", "smartwatch", "tab", "tablet",
        "buds", "soundbar", "ac", "case", "fold", "flip"
      ];
      return !productKeywords.some(pk => q.includes(pk));
    }
    return false;
  }

  isAllProductsQuery(query) {
    if (!query) return false;
    const q = query.toLowerCase().trim();

    const specificTerms = [
      "hp", "handphone", "smartphone", "galaxy", "tv", "kulkas", "mesin cuci",
      "watch", "smartwatch", "tab", "tablet", "buds", "soundbar", "ac", "case",
      "fold", "flip", "promo", "diskon", "murah", "mahal"
    ];
    if (specificTerms.some(term => q.includes(term))) {
      return false;
    }

    const allPatterns = [
      /^semua(\s+produk(nya)?)?$/,
      /^(apa|ada)\s+(aja|saja)(\s+produk(nya)?)?$/,
      /^produk\s+(apa|ada)\s+(aja|saja)$/,
      /^katalog(\s+produk)?$/,
      /^daftar\s+produk$/,
      /^list\s+produk$/,
      /^koleksi(\s+lengkap)?$/,
      /^semuanya$/,
      /^jelasin\s+produk(nya)?$/,
      /^daftar\s+harga$/
    ];
    return allPatterns.some(pattern => pattern.test(q)) || q === "semua produk" || q === "katalog lengkap";
  }

  detectRequestedCategory(normalizedQuery) {
    if (/\b(hp|handphone|ponsel|smartphone)\b/.test(normalizedQuery)) return "Smartphone";
    if (/\b(tab|tablet)\b/.test(normalizedQuery)) return "Tablet";
    if (/\b(tv|televisi|qled|uhd)\b/.test(normalizedQuery)) return "TV";
    if (/\b(watch|smartwatch|jam)\b/.test(normalizedQuery)) return "Smartwatch";
    if (/\b(buds|earbuds|tws|headset|earphone|soundbar|audio)\b/.test(normalizedQuery)) return "Audio";
    if (/\b(kulkas|lemari es)\b/.test(normalizedQuery)) return "Kulkas";
    if (/\b(mesin cuci|washer|laundry)\b/.test(normalizedQuery)) return "Mesin Cuci";
    if (/\b(ac|pendingin|windfree)\b/.test(normalizedQuery)) return "AC";
    if (/\b(case|casing|aksesoris)\b/.test(normalizedQuery)) return "Aksesoris";
    return null;
  }

  search(query, k = this.topK) {
    if (!query || this.products.length === 0) return [];

    const normalized = query.toLowerCase().trim();

    if (this.isGreetingQuery(normalized)) {
      return [];
    }

    if (this.isAllProductsQuery(normalized)) {
      return this.products.slice(0, k);
    }

    const matchedCategory = this.detectRequestedCategory(normalized);

    const queryTokens = normalized
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 2);

    let candidateProducts = this.products;
    if (matchedCategory) {
      candidateProducts = this.products.filter(
        p => p.kategori && p.kategori.toLowerCase() === matchedCategory.toLowerCase()
      );
    }

    // Jika user meminta urutan termurah / termahal
    if (normalized.includes("termurah") || normalized.includes("paling murah")) {
      return [...candidateProducts]
        .sort((a, b) => Number(a.harga) - Number(b.harga))
        .slice(0, k);
    }
    if (normalized.includes("termahal") || normalized.includes("paling mahal")) {
      return [...candidateProducts]
        .sort((a, b) => Number(b.harga) - Number(a.harga))
        .slice(0, k);
    }

    const scored = candidateProducts
      .map(p => {
        let score = 0;
        const searchableText = `${p.nama} ${p.kategori} ${p.deskripsi}`.toLowerCase();

        if (matchedCategory) score += 4;

        for (const token of queryTokens) {
          if (p.nama.toLowerCase().includes(token)) score += 8;
          if (p.kategori.toLowerCase().includes(token)) score += 5;
          if (p.deskripsi.toLowerCase().includes(token)) score += 3;
          if (searchableText.includes(token)) score += 1;
        }

        return { product: p, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      return scored.slice(0, k).map(item => item.product);
    }

    if (matchedCategory && candidateProducts.length > 0) {
      return candidateProducts.slice(0, k);
    }

    return [];
  }

  buildContext(query) {
    const relevantProducts = this.search(query);
    if (!relevantProducts || relevantProducts.length === 0) return "";

    const categoriesSummary = [...new Set(this.products.map(p => p.kategori))].join(", ");

    const grouped = {};
    for (const p of relevantProducts) {
      const cat = p.kategori || "Lainnya";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(p);
    }

    let output = `Total Produk Katalog: ${this.products.length} item (Kategori tersedia: ${categoriesSummary}).\nDaftar Produk Relevan dari Katalog Resmi:\n`;
    for (const [category, items] of Object.entries(grouped)) {
      output += `\n[Kategori: ${category}]\n`;
      items.forEach(p => {
        const hargaFmt = this.formatCurrency(p.harga);
        output += `• ${p.nama}\n  Harga: ${hargaFmt}\n  Detail: ${p.deskripsi}\n  Link Shopee: ${p.link}\n`;
      });
    }

    return output.trim();
  }
}

module.exports = RAGEngine;