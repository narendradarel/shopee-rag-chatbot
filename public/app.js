const API_URL = "/api";
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const qrSection = document.getElementById("qrSection");
const readySection = document.getElementById("readySection");
const botNumberText = document.getElementById("botNumberText");

const knowledgeList = document.getElementById("knowledgeList");
const productsBody = document.getElementById("productsBody");

const refreshQuotaBtn = document.getElementById("refreshQuotaBtn");
const groqReqRemaining = document.getElementById("groqReqRemaining");
const groqReqBar = document.getElementById("groqReqBar");
const groqReqReset = document.getElementById("groqReqReset");
const groqTokenRemaining = document.getElementById("groqTokenRemaining");
const groqTokenBar = document.getElementById("groqTokenBar");
const groqModelName = document.getElementById("groqModelName");
const groqLastChecked = document.getElementById("groqLastChecked");

let currentQRCode = null;

async function checkBotStatus() {
  try {
    const response = await fetch(`${API_URL}/bot/status`);
    if (!response.ok) throw new Error("Gagal memeriksa status bot");
    const data = await response.json();

    if (data.isReady) {
      if (data.botNumber) {
        statusText.textContent = `Bot Connected (${data.botNumber})`;
        if (botNumberText) botNumberText.textContent = data.botNumber;
      } else {
        statusText.textContent = "Bot Connected";
        if (botNumberText) botNumberText.textContent = "Terhubung";
      }
      if (statusDot) statusDot.className = "status-indicator ready";
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
      readySection.classList.remove("hidden");
      qrSection.classList.add("hidden");
      currentQRCode = null;
    } else if (data.hasQRCode) {
      if (botNumberText) botNumberText.textContent = "-";
      statusText.textContent = "Waiting for QR Scan";
      if (statusDot) statusDot.className = "status-indicator waiting";
      qrSection.classList.remove("hidden");
      readySection.classList.add("hidden");
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
      loadQRCode();
    } else if (data.isInitializing) {
      statusText.textContent = "Menginisialisasi Bot WhatsApp...";
      if (statusDot) statusDot.className = "status-indicator waiting";
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
      qrSection.classList.remove("hidden");
      readySection.classList.add("hidden");
    } else {
      statusText.textContent = "Bot Offline";
      if (statusDot) statusDot.className = "status-indicator";
      startBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
      readySection.classList.add("hidden");
      qrSection.classList.add("hidden");
      currentQRCode = null;
    }
  } catch (error) {
    statusText.textContent = "Server Offline (Pastikan backend berjalan)";
    if (statusDot) statusDot.className = "status-indicator";
    startBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
  }
}

async function loadQRCode() {
  try {
    const response = await fetch(`${API_URL}/bot/qr`);
    const data = await response.json();

    if (data.qr && data.qr !== currentQRCode) {
      currentQRCode = data.qr;
      const qrContainer = document.getElementById("qrcode");
      qrContainer.innerHTML = `<img width="280" height="280" alt="QR Code WhatsApp" src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(data.qr)}">`;
    }
  } catch (error) {
    console.error("Gagal memuat QR Code:", error);
  }
}

startBtn.onclick = async () => {
  try {
    startBtn.disabled = true;
    startBtn.textContent = "Memulai...";
    await fetch(`${API_URL}/bot/start`, { method: "POST" });
  } catch (error) {
    console.error("Error memulai bot:", error);
    alert("Gagal mengirim perintah start ke server.");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Mulai Bot";
    checkBotStatus();
  }
};

stopBtn.onclick = async () => {
  try {
    stopBtn.disabled = true;
    stopBtn.textContent = "Menghentikan...";
    await fetch(`${API_URL}/bot/stop`, { method: "POST" });
  } catch (error) {
    console.error("Error menghentikan bot:", error);
    alert("Gagal mengirim perintah stop ke server.");
  } finally {
    stopBtn.disabled = false;
    stopBtn.textContent = "Hentikan Bot";
    checkBotStatus();
  }
};

if (resetBtn) {
  resetBtn.onclick = async () => {
    if (!confirm("Apakah Anda yakin ingin menghapus sesi WhatsApp? Anda harus scan QR ulang.")) {
      return;
    }
    try {
      resetBtn.disabled = true;
      resetBtn.textContent = "Mereset...";
      const res = await fetch(`${API_URL}/bot/reset`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(data.message || "Sesi berhasil dibersihkan!");
      } else {
        alert("Gagal mereset: " + (data.error || "Kesalahan server"));
      }
    } catch (error) {
      console.error("Error mereset bot:", error);
      alert("Gagal menghubungi endpoint reset.");
    } finally {
      resetBtn.disabled = false;
      resetBtn.textContent = "Reset Sesi WA";
      checkBotStatus();
    }
  };
}

async function loadKnowledgeList() {
  if (!knowledgeList) return;
  try {
    const res = await fetch(`${API_URL}/knowledge`);
    const data = await res.json();
    const responses = data.responses || {};
    const keys = Object.keys(responses);

    if (keys.length === 0) {
      knowledgeList.innerHTML = "<em>Belum ada kata kunci kustom.</em>";
      return;
    }

    knowledgeList.innerHTML = keys
      .map(k => `<span class="tag-item" title="${responses[k]}"><strong>${k}</strong></span>`)
      .join("");
  } catch (err) {
    knowledgeList.innerHTML = "<em>Gagal memuat basis pengetahuan.</em>";
  }
}

async function loadProductsList() {
  if (!productsBody) return;
  try {
    const res = await fetch(`${API_URL}/products`);
    const data = await res.json();
    const products = data.products || [];

    if (products.length === 0) {
      productsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Tidak ada data produk.</td></tr>';
      return;
    }

    productsBody.innerHTML = products
      .map(p => {
        const harga = Number(p.harga);
        const formatted = isNaN(harga)
          ? p.harga
          : new Intl.NumberFormat("id-ID", {
              style: "currency",
              currency: "IDR",
              maximumFractionDigits: 0
            }).format(harga);

        const linkCell = p.link
          ? `<a href="${p.link}" target="_blank" rel="noopener noreferrer" class="shopee-link">Buka Produk ↗</a>`
          : "-";

        return `
          <tr>
            <td><strong>${p.nama}</strong></td>
            <td><span class="tag-item">${p.kategori}</span></td>
            <td style="white-space:nowrap;">${formatted}</td>
            <td>${p.deskripsi}</td>
            <td>${linkCell}</td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    productsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:red;">Gagal memuat produk dari server.</td></tr>';
  }
}

async function loadGroqQuota(isFresh = false) {
  try {
    const url = isFresh ? `${API_URL}/groq/quota?fresh=true` : `${API_URL}/groq/quota`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Gagal mengambil data kuota");
    const data = await res.json();

    if (data.configured) {
      if (groqModelName) groqModelName.textContent = data.model || "-";
      if (groqLastChecked) groqLastChecked.textContent = `Pembaruan: ${data.lastChecked || "Baru saja"}`;

      if (data.remainingRequests !== null && data.limitRequests !== null) {
        if (groqReqRemaining) {
          groqReqRemaining.textContent = `${Number(data.remainingRequests).toLocaleString()} / ${Number(data.limitRequests).toLocaleString()}`;
        }
        if (groqReqBar) {
          const pct = Math.max(0, Math.min(100, (data.remainingRequests / data.limitRequests) * 100));
          groqReqBar.style.width = `${pct}%`;
          groqReqBar.className = pct < 20 ? "progress-bar-fill danger" : pct < 50 ? "progress-bar-fill warning" : "progress-bar-fill";
        }
        if (groqReqReset && data.resetRequests) {
          groqReqReset.textContent = `Reset dalam: ${data.resetRequests}`;
        }
      } else {
        if (groqReqRemaining) groqReqRemaining.textContent = "Aktif (Menunggu data)";
      }

      if (data.remainingTokens !== null && data.limitTokens !== null) {
        if (groqTokenRemaining) {
          groqTokenRemaining.textContent = `${Number(data.remainingTokens).toLocaleString()} / ${Number(data.limitTokens).toLocaleString()}`;
        }
        if (groqTokenBar) {
          const pct = Math.max(0, Math.min(100, (data.remainingTokens / data.limitTokens) * 100));
          groqTokenBar.style.width = `${pct}%`;
        }
      } else {
        if (groqTokenRemaining) groqTokenRemaining.textContent = "Aktif (Menunggu data)";
      }
    } else {
      if (groqModelName) groqModelName.textContent = "Belum Dikonfigurasi (.env)";
      if (groqReqRemaining) groqReqRemaining.textContent = "-";
      if (groqTokenRemaining) groqTokenRemaining.textContent = "-";
    }
  } catch (err) {
    console.warn("Gagal memuat kuota Groq:", err);
  }
}

if (refreshQuotaBtn) {
  refreshQuotaBtn.onclick = async () => {
    refreshQuotaBtn.disabled = true;
    refreshQuotaBtn.textContent = "Memeriksa...";
    await loadGroqQuota(true);
    refreshQuotaBtn.disabled = false;
    refreshQuotaBtn.textContent = "🔄 Cek Kuota";
  };
}

checkBotStatus();
loadKnowledgeList();
loadProductsList();
loadGroqQuota();
setInterval(checkBotStatus, 5000);
setInterval(() => loadGroqQuota(false), 20000);