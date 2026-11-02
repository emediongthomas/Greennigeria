function demoTimestamp(daysAgo, hours, minutes) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

const initialTransactions = [
  { name: "Lia steve", description: "Transfer · GTBank", timestamp: demoTimestamp(0, 11, 42), amount: -25000, icon: "↗", kind: "outgoing", status: "SAMPLE" },
  { name: "Enobong", description: "Money received", timestamp: demoTimestamp(0, 9, 15), amount: 350000, icon: "↓", kind: "incoming", status: "SAMPLE" },
  { name: "Tunde Adebayo", description: "Transfer · Access Bank", timestamp: demoTimestamp(1, 16, 20), amount: -12000, icon: "↗", kind: "outgoing", status: "SAMPLE" },
  { name: "Airtime top-up", description: "MTN", timestamp: demoTimestamp(1, 13, 5), amount: -2000, icon: "◉", kind: "airtime", status: "SAMPLE" },
  { name: "Zainab Musa", description: "Money received", timestamp: demoTimestamp(3, 10, 30), amount: 45000, icon: "↓", kind: "incoming", status: "SAMPLE" }
];

const storageKeys = {
  profileImage: "greenNigeria.profileImage",
  displayName: "greenNigeria.displayName",
  balanceHidden: "greenNigeria.balanceHidden"
};
const pageNames = { home: "Overview", transfer: "Transfers", activity: "Activity", scan: "Scan account", assistant: "AI assistant", profile: "My profile" };
let transactions = initialTransactions;
let toastTimer;
let sandboxApiReady = false;
let transferIdempotencyKey = null;

function money(amount, decimals = true) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0
  }).format(Math.abs(amount));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function transactionDetail(transaction) {
  if (!transaction.timestamp) return transaction.detail;
  const date = new Date(transaction.timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const when = isToday
    ? `Today, ${date.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`
    : date.toDateString() === yesterday.toDateString()
      ? `Yesterday, ${date.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`
      : date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  return `${transaction.description} · ${when}`;
}

function isTransactionToday(transaction) {
  return transaction.timestamp
    ? new Date(transaction.timestamp).toDateString() === new Date().toDateString()
    : transaction.detail.includes("Today");
}

function renderTransactionRows(items) {
  return items.map(transaction => {
    const amountClass = transaction.amount < 0 ? "negative" : "positive";
    const amount = transaction.amount < 0 ? money(transaction.amount) : `+ ${money(transaction.amount)}`;
    return `<div class="transaction-row">
      <span class="tx-icon ${escapeHtml(transaction.kind)}">${escapeHtml(transaction.icon)}</span>
      <div class="tx-info"><strong>${escapeHtml(transaction.name)}</strong><span>${escapeHtml(transactionDetail(transaction))}</span></div>
      <span class="tx-amount ${amountClass}">${amount}</span>
      <span class="tx-status ${transaction.status === "SIMULATED" ? "simulated" : "sample"}">${escapeHtml(transaction.status || "SAMPLE")}</span>
    </div>`;
  }).join("");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function renderTransactions() {
  const rows = renderTransactionRows(transactions);
  const recentRows = renderTransactionRows(transactions.filter(isTransactionToday));
  document.getElementById("recentTransactions").innerHTML = recentRows || '<div class="empty-transactions">No transactions recorded today.</div>';
  document.getElementById("allTransactions").innerHTML = rows || '<div class="empty-transactions">No demo transactions yet. Your activity will appear here.</div>';
  const todayCount = transactions.filter(isTransactionToday).length;
  document.getElementById("todayTransactionCount").textContent = `${todayCount} transaction${todayCount === 1 ? "" : "s"}`;
  document.getElementById("allTransactionCount").textContent = `${transactions.length} total`;
  document.getElementById("monthlyCount").textContent = `${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`;
}

function setView(view) {
  if (!pageNames[view]) return;
  document.querySelectorAll(".view").forEach(section => section.classList.toggle("active", section.id === `view-${view}`));
  document.querySelectorAll(".nav-item, .mobile-tab").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.getElementById("pageCrumb").textContent = pageNames[view];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll(".person[data-person]").forEach(button => {
  button.addEventListener("click", () => {
    document.getElementById("recipientName").value = button.dataset.person;
    setView("transfer");
  });
});

document.getElementById("allPeople").addEventListener("click", () => showToast("Your saved people are ready to grow with you."));

document.getElementById("toggleBalance").addEventListener("click", event => {
  const amount = document.getElementById("balanceAmount");
  const hidden = amount.dataset.hidden !== "true";
  amount.dataset.hidden = String(hidden);
  amount.innerHTML = hidden ? "₦ ••••••••" : "₦ 2,450,780<span>.50</span>";
  event.currentTarget.setAttribute("aria-label", hidden ? "Show balance" : "Hide balance");
  localStorage.setItem(storageKeys.balanceHidden, String(hidden));
});

document.getElementById("reviewTransfer").addEventListener("click", () => {
  const name = document.getElementById("recipientName").value.trim();
  const bank = document.getElementById("bankName").value;
  const account = document.getElementById("accountNumber").value.trim();
  const rawAmount = document.getElementById("transferAmount").value.replace(/[,\s₦]/g, "");
  const amount = Number(rawAmount);
  if (!name || !bank || !/^\d{10}$/.test(account) || !/^\d+(\.\d{1,2})?$/.test(rawAmount) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
    showToast("Enter a name, bank, 10-digit account number, and an amount up to ₦1,000,000,000 with at most 2 decimal places.");
    return;
  }
  transferIdempotencyKey = crypto.randomUUID();
  document.getElementById("reviewName").textContent = name;
  document.getElementById("reviewBank").textContent = bank;
  document.getElementById("reviewAccount").textContent = account;
  document.getElementById("reviewNote").textContent = document.getElementById("transferNote").value.trim() || "—";
  document.getElementById("reviewAmount").textContent = money(amount);
  document.getElementById("confirmModal").hidden = false;
});

function closeModal() {
  document.getElementById("confirmModal").hidden = true;
}
document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("editTransfer").addEventListener("click", closeModal);
document.getElementById("confirmModal").addEventListener("click", event => {
  if (event.target.id === "confirmModal") closeModal();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

document.getElementById("confirmTransfer").addEventListener("click", async event => {
  if (!sandboxApiReady) {
    showToast("Sandbox API is offline. Start it with py -3 server.py and retry.");
    return;
  }
  const button = event.currentTarget;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Recording sandbox transfer…";
  try {
    const response = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientName: document.getElementById("recipientName").value.trim(),
        bank: document.getElementById("bankName").value,
        accountNumber: document.getElementById("accountNumber").value.trim(),
        amount: document.getElementById("transferAmount").value.replace(/[,\s₦]/g, ""),
        idempotencyKey: transferIdempotencyKey
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sandbox transfer could not be recorded.");
    transactions = [result, ...transactions.filter(item => item.reference !== result.reference)];
    transferIdempotencyKey = null;
    renderTransactions();
    closeModal();
    document.getElementById("recipientName").value = "";
    document.getElementById("bankName").value = "";
    document.getElementById("accountNumber").value = "";
    document.getElementById("transferAmount").value = "";
    document.getElementById("transferNote").value = "";
    setView("activity");
    showToast("Sandbox transfer recorded by the local API. No money was moved.");
  } catch (error) {
    console.error("Sandbox transfer request failed.", error);
    showToast(error instanceof TypeError ? "Sandbox API unavailable. Check that the local server is running." : error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

function applyAccountNumber(value) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length !== 10) {
    showToast("No complete 10-digit account number found. Please check the image or enter it manually.");
    return false;
  }
  document.getElementById("accountNumber").value = digits;
  setView("transfer");
  showToast("Account number added. Please verify it before continuing.");
  return true;
}

document.getElementById("useManualAccount").addEventListener("click", () => {
  const account = document.getElementById("manualAccount").value.trim();
  if (applyAccountNumber(account)) document.getElementById("manualAccount").value = "";
});

const scanFile = document.getElementById("scanFile");
document.getElementById("takePhoto").addEventListener("click", () => scanFile.click());
document.getElementById("uploadPhoto").addEventListener("click", () => scanFile.click());
document.getElementById("scanAgain").addEventListener("click", () => {
  scanFile.value = "";
  document.getElementById("scanPreview").hidden = true;
  document.getElementById("scanDropzone").hidden = false;
});

scanFile.addEventListener("change", async () => {
  const file = scanFile.files && scanFile.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Choose an image file to scan.");
    scanFile.value = "";
    return;
  }
  const preview = document.getElementById("previewImage");
  const imageUrl = URL.createObjectURL(file);
  preview.src = imageUrl;
  preview.onload = () => URL.revokeObjectURL(imageUrl);
  document.getElementById("scanDropzone").hidden = true;
  document.getElementById("scanPreview").hidden = false;
  document.getElementById("scanSpinner").classList.remove("done");
  document.getElementById("scanMessage").textContent = "Reading image on this device…";
  try {
    if (!window.Tesseract) throw new Error("Text-recognition library unavailable");
    const result = await window.Tesseract.recognize(file, "eng");
    const text = result.data.text;
    const accountCandidate = text.match(/(?:\D|^)(\d[\d\s-]{8,16}\d)(?:\D|$)/g)
      ?.map(candidate => candidate.replace(/\D/g, ""))
      .find(candidate => candidate.length === 10);
    document.getElementById("scanSpinner").classList.add("done");
    if (accountCandidate) {
      document.getElementById("scanMessage").textContent = `Found a possible account number: ${accountCandidate}`;
      const useNumber = document.createElement("button");
      useNumber.type = "button";
      useNumber.className = "button button-dark";
      useNumber.textContent = "Use this number";
      useNumber.addEventListener("click", () => applyAccountNumber(accountCandidate));
      document.getElementById("scanMessage").appendChild(document.createTextNode(" "));
      document.getElementById("scanMessage").appendChild(useNumber);
    } else {
      document.getElementById("scanMessage").textContent = "We couldn’t confidently find a 10-digit number. Please enter it below.";
    }
  } catch (error) {
    console.error("Account scan failed.", error);
    document.getElementById("scanSpinner").classList.add("done");
    document.getElementById("scanMessage").textContent = "Could not read this image. You can enter the account number below.";
  }
});

function saveProfileImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Choose an image file for your profile photo.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = String(reader.result);
    try {
      localStorage.setItem(storageKeys.profileImage, image);
      setProfileImage(image);
      showToast("Your profile photo was saved on this device.");
    } catch (error) {
      console.error("Could not save profile photo.", error);
      showToast("This photo is too large to save here. Try a smaller image.");
    }
  };
  reader.onerror = () => showToast("Could not read this photo. Please try another image.");
  reader.readAsDataURL(file);
}

function setProfileImage(image) {
  ["profileAvatar", "sidebarAvatar", "topAvatar"].forEach(id => {
    const element = document.getElementById(id);
    element.style.backgroundImage = `url("${image}")`;
    element.style.backgroundSize = "cover";
    element.style.backgroundPosition = "center";
    element.textContent = "";
  });
}

document.getElementById("profilePhotoInput").addEventListener("change", event => {
  saveProfileImage(event.target.files && event.target.files[0]);
  event.target.value = "";
});

document.getElementById("editProfile").addEventListener("click", () => {
  const current = localStorage.getItem(storageKeys.displayName) || "Ada Okafor";
  const newName = window.prompt("Choose a display name:", current);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    showToast("Your display name cannot be empty.");
    return;
  }
  localStorage.setItem(storageKeys.displayName, trimmed);
  setDisplayName(trimmed);
  showToast("Your display name has been updated.");
});

function setDisplayName(name) {
  document.getElementById("profileDisplayName").textContent = name;
  document.getElementById("profileFullName").textContent = name;
  document.getElementById("sidebarName").textContent = name;
  document.getElementById("welcomeName").textContent = name.split(/\s+/)[0];
  if (!localStorage.getItem(storageKeys.profileImage)) {
    const initial = name.trim().charAt(0).toUpperCase();
    ["profileAvatar", "sidebarAvatar", "topAvatar"].forEach(id => {
      document.getElementById(id).textContent = initial;
    });
  }
}

function addChatMessage(text, sender) {
  const container = document.getElementById("chatMessages");
  const message = document.createElement("div");
  message.className = `message ${sender === "user" ? "user-message" : "assistant-message"}`;
  const contents = document.createElement("div");
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = "Just now";
  contents.append(paragraph, time);
  if (sender === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.textContent = "✳";
    message.append(avatar, contents);
  } else {
    message.append(contents);
  }
  container.appendChild(message);
  container.scrollTop = container.scrollHeight;
}

function assistantReply(message) {
  const normalized = message.toLowerCase();
  if (normalized.includes("spend") || normalized.includes("week")) {
    return "Your sample spending this week is ₦184,500, which is 12.4% lower than last week. This is demo data, not live bank activity.";
  }
  if (normalized.includes("transfer") || normalized.includes("send")) {
    return "I can help you get started. Open Transfers, enter the recipient’s bank details and amount, then review everything carefully. This prototype records demo activity only.";
  }
  if (normalized.includes("scan") || normalized.includes("account number") || normalized.includes("photo")) {
    return "Open Scan account to take a photo or upload an image. The browser will try to read a 10-digit number, but please verify it before using it.";
  }
  if (normalized.includes("balance")) {
    return "The balance shown here is sample data for the prototype. Green Nigeria is not connected to a bank account.";
  }
  return "I’m a demo assistant, so I can help you explore transfers, account scanning, and sample spending. I can’t access bank accounts or move money.";
}

document.getElementById("chatForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message) return;
  addChatMessage(message, "user");
  input.value = "";
  window.setTimeout(() => addChatMessage(assistantReply(message), "assistant"), 350);
});
document.querySelectorAll(".suggestion").forEach(button => {
  button.addEventListener("click", () => {
    document.getElementById("chatInput").value = button.dataset.prompt;
    document.getElementById("chatForm").requestSubmit();
  });
});

document.getElementById("downloadActivity").addEventListener("click", () => {
  const header = "Name,Details,Amount (NGN)";
  const data = transactions.map(transaction =>
    [transaction.name, transaction.detail, transaction.amount].map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")
  );
  const blob = new Blob([[header, ...data].join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "green-nigeria-demo-activity.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

async function initialize() {
  const today = new Date();
  document.getElementById("todayLabel").textContent = today.toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
  const name = localStorage.getItem(storageKeys.displayName);
  if (name) setDisplayName(name);
  const profileImage = localStorage.getItem(storageKeys.profileImage);
  if (profileImage) setProfileImage(profileImage);
  if (localStorage.getItem(storageKeys.balanceHidden) === "true") {
    document.getElementById("balanceAmount").dataset.hidden = "true";
    document.getElementById("balanceAmount").innerHTML = "₦ ••••••••";
    document.getElementById("toggleBalance").setAttribute("aria-label", "Show balance");
  }
  renderTransactions();
  const connection = document.getElementById("sandboxConnection");
  const badge = document.querySelector(".demo-pill");
  try {
    const healthResponse = await fetch("/api/health");
    if (!healthResponse.ok) throw new Error(`Sandbox health check failed (${healthResponse.status}).`);
    const health = await healthResponse.json();
    if (health.mode !== "sandbox" || health.livePaymentsEnabled !== false) {
      throw new Error("The API did not confirm sandbox-only mode.");
    }
    const historyResponse = await fetch("/api/transactions");
    if (!historyResponse.ok) throw new Error(`Sandbox transaction history failed (${historyResponse.status}).`);
    const history = await historyResponse.json();
    if (!Array.isArray(history.transactions)) throw new Error("Sandbox transaction history has an invalid response.");
    transactions = [...history.transactions, ...initialTransactions];
    sandboxApiReady = true;
    connection.textContent = "API CONNECTED";
    badge.classList.add("connected");
    renderTransactions();
  } catch (error) {
    console.error("Could not connect to the Green Nigeria sandbox API.", error);
    connection.textContent = "API OFFLINE";
    badge.classList.add("offline");
    showToast("Sandbox API offline. Run py -3 server.py from the project folder.");
  }
}

initialize();
