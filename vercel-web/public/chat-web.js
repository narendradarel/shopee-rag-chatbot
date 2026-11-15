
const API_URL = "/api/chat";

const form = document.getElementById("chatForm");
const input = document.getElementById("chatInput");
const chatBox = document.getElementById("chatBox");
const sendBtn = document.getElementById("sendBtn");
const apiStatus = document.getElementById("apiStatus");

let isLoading = false;

// Periksa koneksi API
async function checkStatus() {
    try {
        const response = await fetch(API_URL, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("API tidak tersedia");
        }

        const data = await response.json();

        if (data.status !== "online") {
            throw new Error("API belum siap");
        }

        const count = Number(data.totalProduk);

        apiStatus.classList.add("online");

        if (Number.isFinite(count)) {
            apiStatus.textContent =
                count > 0
                    ? `API aktif · ${count} produk`
                    : "API aktif · Katalog kosong";
        } else {
            apiStatus.textContent = "API aktif";
        }

    } catch (error) {
        apiStatus.classList.remove("online");
        apiStatus.textContent = "API tidak tersedia";
        console.error(error);
    }
}

// Tambahkan pesan ke percakapan
function addMessage(text, sender = "bot") {
    const welcome = document.getElementById("welcome");

    if (welcome) {
        welcome.remove();
    }

    const message = document.createElement("div");
    message.className = `message ${sender}`;

    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = sender === "user" ? "Kamu" : "Asisten";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;

    message.append(label, bubble);
    chatBox.appendChild(message);

    chatBox.scrollTop = chatBox.scrollHeight;

    return bubble;
}


function renderProducts(items, container) {
    if (!Array.isArray(items) || !items.length) return;

    const list = document.createElement("div");
    list.className = "product-list";

    items.forEach(product => {
        const card = document.createElement("div");
        card.className = "product-card";

        function addText(tag, className, value) {
            if (!value) return;
            const el = document.createElement(tag);
            el.className = className;
            el.textContent = value;
            card.appendChild(el);
        }

        addText("span", "product-category", product.category);
        addText("strong", "product-name", product.name);
        addText("p", "product-desc", product.description);
        addText("strong", "product-price", product.price);

        if (product.rating) {
            addText("span", "product-rating", `Rating ${product.rating}`);
        }

        if (product.url) {
            const link = document.createElement("a");
            link.href = product.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "product-link";
            link.textContent = "Lihat di Shopee ↗";
            card.appendChild(link);
        }

        list.appendChild(card);
    });

    container.appendChild(list);
    chatBox.scrollTop = chatBox.scrollHeight;
}


// Kirim pertanyaan ke RAG API
form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isLoading) return;

    const message = input.value.trim();
    if (!message) return;

    isLoading = true;
    sendBtn.disabled = true;
    input.disabled = true;

    addMessage(message, "user");
    input.value = "";
    input.style.height = "auto";

    const botBubble = addMessage(
        "Sedang memproses jawaban...",
        "bot"
    );

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Terjadi kesalahan pada server"
            );
        }

        botBubble.textContent =
            data.reply || "Tidak ada jawaban dari chatbot.";

    } catch (error) {
        botBubble.textContent =
            "Gagal memproses pertanyaan. " + error.message;

        console.error("Chat error:", error);

    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
});

// Enter mengirim pesan, Shift+Enter membuat baris baru
input.addEventListener("keydown", (event) => {
    if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
    ) {
        event.preventDefault();

        if (!isLoading) {
            form.requestSubmit();
        }
    }
});

// Sesuaikan tinggi kolom input
input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height =
        `${Math.min(input.scrollHeight, 150)}px`;
});

checkStatus();
