const form = document.getElementById("chatForm");
const input = document.getElementById("chatInput");
const chatBox = document.getElementById("chatBox");

function addMessage(text, sender = "bot") {
    const div = document.createElement("div");
    div.className = `message ${sender}`;
    div.textContent = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function setQuestion(text) {
    input.value = text;
    input.focus();
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = input.value.trim();
    if (!message) return;

    addMessage(message, "user");
    input.value = "";

    addMessage("Sedang memproses jawaban...", "bot");

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        // hapus pesan loading terakhir
        const botMessages = document.querySelectorAll(".message.bot");
        const lastBot = botMessages[botMessages.length - 1];
        if (lastBot && lastBot.textContent === "Sedang memproses jawaban...") {
            lastBot.remove();
        }

        if (!response.ok) {
            addMessage(data.error || "Terjadi kesalahan pada server.", "bot");
            return;
        }

        addMessage(data.reply || "Tidak ada jawaban dari chatbot.", "bot");
    } catch (error) {
        const botMessages = document.querySelectorAll(".message.bot");
        const lastBot = botMessages[botMessages.length - 1];
        if (lastBot && lastBot.textContent === "Sedang memproses jawaban...") {
            lastBot.remove();
        }

        addMessage("Gagal menghubungi server chatbot.", "bot");
    }
});