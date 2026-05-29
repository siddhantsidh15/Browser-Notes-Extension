// content.js - Injected into every page for toast notifications

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "showToast") {
    showToast(message.message);
  }
});

function showToast(text) {
  // Remove any existing toast
  const existing = document.getElementById("save-to-notes-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "save-to-notes-toast";
  toast.textContent = text;

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "28px",
    right: "28px",
    background: "#1a1a2e",
    color: "#e0e0ff",
    padding: "12px 20px",
    borderRadius: "10px",
    fontSize: "14px",
    fontFamily: "'Segoe UI', sans-serif",
    fontWeight: "500",
    boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
    zIndex: "2147483647",
    opacity: "0",
    transform: "translateY(12px)",
    transition: "opacity 0.25s ease, transform 0.25s ease",
    borderLeft: "4px solid #7c6af7",
    pointerEvents: "none",
  });

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });
  });

  // Animate out and remove
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(12px)";
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
