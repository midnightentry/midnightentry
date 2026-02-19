const PIN_HASH = "7377a71607a8dabc029ab10e7a6a895b92e87762538b10ce8b10c4c9ddc74448";
const $ = (id) => document.getElementById(id);

let ws = null;
let aesKey = null;
let roomId = "";

async function sha256Hex(text){
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

function b64urlToBytes(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes){
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function addSys(text){
  const d = document.createElement("div");
  d.className = "sys";
  d.textContent = text;
  $("log").appendChild(d);
  $("log").scrollTop = $("log").scrollHeight;
}
function addMsg(text, mine=false){
  const d = document.createElement("div");
  d.className = "bubble" + (mine ? " me" : "");
  d.textContent = text;
  $("log").appendChild(d);
  $("log").scrollTop = $("log").scrollHeight;
}

function roomIdFromPath(){
  const parts = location.pathname.split("/").filter(Boolean);
  return parts[1] || "";
}
function keyFromHash(){
  const m = location.hash.match(/k=([^&]+)/);
  return m ? m[1] : "";
}

async function importAesKey(raw32){
  return crypto.subtle.importKey("raw", raw32, { name:"AES-GCM" }, false, ["encrypt","decrypt"]);
}

async function encryptJson(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ctBuf = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, pt);
  return { iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ctBuf)) };
}

async function decryptJson(key, ivB64, ctB64){
  const iv = b64urlToBytes(ivB64);
  const ct = b64urlToBytes(ctB64);
  const ptBuf = await crypto.subtle.decrypt({ name:"AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(ptBuf));
}

// Derive final key from (linkKey + passphrase)
async function deriveKey(linkKeyBytes, passphrase, roomId){
  // PBKDF2(passphrase, salt=roomId) -> 32 bytes
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name:"PBKDF2", salt:new TextEncoder().encode("room:"+roomId), iterations:120000, hash:"SHA-256" },
    baseKey,
    256
  );
  const passBytes = new Uint8Array(bits);

  // XOR passBytes with linkKeyBytes to get final raw key
  const raw = new Uint8Array(32);
  for (let i=0;i<32;i++) raw[i] = passBytes[i] ^ linkKeyBytes[i];
  return raw;
}

// Short match code from derived key
function matchCode(rawKeyBytes){
  // 6 chars base32-ish from first 4 bytes
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let x = 0;
  for (let i=0;i<4;i++) x = (x << 8) | rawKeyBytes[i];
  let out = "";
  for (let i=0;i<6;i++){
    out += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length);
  }
  return out.slice(0,3) + "-" + out.slice(3);
}

function initEmojiRow(){
  const emojis = ["😀","😂","🥹","😍","😌","🤍","🩵","💙","✨","🔥","🙏🏽","👍🏽"];
  const row = $("emojiRow");
  row.innerHTML = "";
  emojis.forEach(em => {
    const b = document.createElement("button");
    b.className = "emojiBtn";
    b.type = "button";
    b.textContent = em;
    b.onclick = () => { $("text").value = ($("text").value || "") + em; $("text").focus(); };
    row.appendChild(b);
  });
}

async function connect(){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${proto}://${location.host}/?room=${encodeURIComponent(roomId)}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => addSys("Connected."));
  ws.addEventListener("message", async (ev) => {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }

    if (msg.type === "sys" && msg.event === "ended") {
      addSys("Session ended.");
      $("log").innerHTML = "";
      return;
    }

    if (msg.type === "msg") {
      try{
        const obj = await decryptJson(aesKey, msg.iv, msg.ct);
        if (obj && typeof obj.text === "string") addMsg(obj.text, false);
      } catch {}
    }
  });

  ws.addEventListener("close", (e) => {
    // Render/WS close reason sometimes comes through
    const reason = (e && e.reason) ? e.reason : "";
    if (reason.includes("sealed")) addSys("Room is already full.");
    else if (reason.includes("expired")) addSys("Room link expired.");
    else addSys("Disconnected.");
  });

  setInterval(() => {
    try { ws && ws.send(JSON.stringify({ type:"ping" })); } catch {}
  }, 25000);
}

async function sendText(){
  const text = ($("text").value || "").trim();
  if (!text) return;
  $("text").value = "";
  addMsg(text, true);

  const enc = await encryptJson(aesKey, { text, ts: Date.now() });
  try { ws && ws.send(JSON.stringify({ type:"msg", iv: enc.iv, ct: enc.ct })); } catch {}
}

function lockNow(){
  sessionStorage.removeItem("unlocked");
  try { ws && ws.close(); } catch {}
  ws = null;
  $("log").innerHTML = "";
  $("meta").textContent = "Locked…";
  $("modal").style.display = "grid";
}

(async function main(){
  initEmojiRow();

  roomId = roomIdFromPath();
  const k = keyFromHash();

  if (!roomId || !/^[a-zA-Z0-9_-]{6,64}$/.test(roomId)) {
    addSys("Invalid link.");
    $("meta").textContent = "Invalid";
    return;
  }
  if (!k) {
    addSys("Missing key.");
    $("meta").textContent = "Missing key";
    return;
  }

  const linkKey = b64urlToBytes(k);
  if (linkKey.length !== 32) {
    addSys("Invalid key.");
    $("meta").textContent = "Invalid";
    return;
  }

  $("send").addEventListener("click", sendText);
  $("text").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });

  $("endBtn").addEventListener("click", () => {
    try { ws && ws.send(JSON.stringify({ type:"end" })); } catch {}
    try { ws && ws.close(); } catch {}
    $("log").innerHTML = "";
    addSys("Ended.");
  });

  $("lockBtn").addEventListener("click", lockNow);

  // Unlock flow
  $("go").addEventListener("click", async () => {
    const pin = ($("pin").value || "").trim();
    const pass = ($("pass").value || "").trim();
    if (!pin || !pass) return;

    const h = await sha256Hex(pin);
    if (h !== PIN_HASH) {
      // decoy: just close modal without drama
      $("modal").style.display = "none";
      addSys(" ");
      return;
    }

    const raw = await deriveKey(linkKey, pass, roomId);
    aesKey = await importAesKey(raw);

    $("meta").textContent = `Match: ${matchCode(raw)}`;
    $("modal").style.display = "none";

    await connect();
  });
})();
