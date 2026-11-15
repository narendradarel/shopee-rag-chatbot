
const form = document.getElementById("chatForm");
const input = document.getElementById("chatInput");
const answer = document.getElementById("chatAnswer");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = input.value.trim();
  if (!message) return;

  answer.textContent = "Sedang memproses...";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Server error");
    }

    answer.textContent = data.reply;

  } catch (error) {
    answer.textContent = `Gagal: ${error.message}`;
  }
});
