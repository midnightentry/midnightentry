const PIN_HASH = "7377a71607a8dabc029ab10e7a6a895b92e87762538b10ce8b10c4c9ddc74448";
const $ = (id) => document.getElementById(id);

let ws = null;
let aesKey = null;
let roomId = "";
let rawKeyBytes = null;

let connected = false;
let ended = false;
let reconnectTimer = null;
let reconnectAttempt = 0;

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

  const raw = new Uint8Array(32);
  for (let i=0;i<32;i++) raw[i] = passBytes[i] ^ linkKeyBytes[i];
  return raw;
}

function matchCode(rawKeyBytes){
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

function setMeta(text){
  $("meta").textContent = text;
}

function setUiConnected(isConnected){
  connected = isConnected;
  $("send").disabled = !isConnected;
  $("text").disabled = !isConnected;
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

function clearReconnect(){
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(reasonText="Reconnecting…"){
  if (ended) return;
  if (reconnectTimer) return;

  reconnectAttempt += 1;
  const delay = Math.min(12000, 900 + reconnectAttempt * 900); // 0.9s -> up to 12s
  setMeta(`${matchCode(rawKeyBytes)} • ${reasonText}`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectWs(true);
  }, delay);
}

async function connectWs(isReconnect=false){
  if (!aesKey || !roomId) return;

  clearReconnect();

  try { if (ws) ws.close(); } catch {}
  ws = null;

  setUiConnected(false);

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${proto}://${location.host}/?room=${encodeURIComponent(roomId)}`;

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    setUiConnected(true);
    setMeta(`${matchCode(rawKeyBytes)} • Connected`);
    if (!isReconnect) addSys("Connected.");
    else addSys("Reconnected.");
  });

  ws.addEventListener("message", async (ev) => {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }

    if (msg.type === "sys") {
      if (msg.event === "joined") {
        if (msg.sealed) addSys("Room sealed (2 users).");
        return;
      }
      if (msg.event === "ended") {
        ended = true;
        setUiConnected(false);
        setMeta(`${matchCode(rawKeyBytes)} • Ended`);
        addSys("Session ended.");
        $("log").innerHTML = "";
        return;
      }
    }

    if (msg.type === "msg") {
      try{
        const obj = await decryptJson(aesKey, msg.iv, msg.ct);
        if (obj && typeof obj.text === "string") addMsg(obj.text, false);
      } catch {}
    }
  });

  ws.addEventListener("close", (e) => {
    setUiConnected(false);
    if (ended) return;

    const reason = (e && e.reason) ? String(e.reason) : "";

    // Friendly failures
    if (reason.includes("sealed")) {
      ended = true;
      setMeta(`${matchCode(rawKeyBytes)} • Room full`);
      addSys("Room is already full.");
      return;
    }
    if (reason.includes("expired")) {
      ended = true;
      setMeta(`${matchCode(rawKeyBytes)} • Expired`);
      addSys("Room link expired.");
      return;
    }

    scheduleReconnect("Reconnecting…");
  });

  ws.addEventListener("error", () => {
    setUiConnected(false);
  });

  // Keepalive ping
  setInterval(() => {
    try { ws && ws.readyState === 1 && ws.send(JSON.stringify({ type:"ping" })); } catch {}
  }, 25000);
}

async function sendText(){
  if (!connected || !aesKey) return;

  const text = ($("text").value || "").trim();
  if (!text) return;
  $("text").value = "";

  addMsg(text, true);

  const enc = await encryptJson(aesKey, { text, ts: Date.now() });
  try {
    ws && ws.readyState === 1 && ws.send(JSON.stringify({ type:"msg", iv: enc.iv, ct: enc.ct }));
  } catch {}
}

function lockNow(){
  sessionStorage.removeItem("unlocked");
  ended = true; // stop reconnects
  clearReconnect();
  try { ws && ws.close(); } catch {}
  ws = null;

  $("log").innerHTML = "";
  setUiConnected(false);
  setMeta("Locked…");

  $("modal").style.display = "grid";
}

async function unlockFlow(){
  const pin = ($("pin").value || "").trim();
  const pass = ($("pass").value || "").trim();
  if (!pin || !pass) return;

  const h = await sha256Hex(pin);

  // Decoy behavior: no drama
  if (h !== PIN_HASH) {
    $("modal").style.display = "none";
    addSys(" ");
    return;
  }

  const linkKeyStr = keyFromHash();
  const linkKey = b64urlToBytes(linkKeyStr);

  const raw = await deriveKey(linkKey, pass, roomId);
  rawKeyBytes = raw;

  aesKey = await importAesKey(raw);

  $("modal").style.display = "none";
  setMeta(`${matchCode(rawKeyBytes)} • Connecting…`);

  ended = false;
  await connectWs(false);
}

(async function main(){
  initEmojiRow();

  roomId = roomIdFromPath();
  const k = keyFromHash();

  if (!roomId || !/^[a-zA-Z0-9_-]{6,64}$/.test(roomId)) {
    addSys("Invalid link.");
    setMeta("Invalid");
    setUiConnected(false);
    return;
  }
  if (!k) {
    addSys("Missing key.");
    setMeta("Missing key");
    setUiConnected(false);
    return;
  }

  const linkKey = b64urlToBytes(k);
  if (linkKey.length !== 32) {
    addSys("Invalid key.");
    setMeta("Invalid");
    setUiConnected(false);
    return;
  }

  // Start locked
  setUiConnected(false);
  setMeta("Locked…");
  $("modal").style.display = "grid";

  $("go").addEventListener("click", unlockFlow);
  $("pass").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockFlow(); });
  $("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockFlow(); });

  $("send").addEventListener("click", sendText);
  $("text").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });

  $("endBtn").addEventListener("click", () => {
    ended = true;
    clearReconnect();
    try { ws && ws.readyState === 1 && ws.send(JSON.stringify({ type:"end" })); } catch {}
    try { ws && ws.close(); } catch {}
    ws = null;
    $("log").innerHTML = "";
    setUiConnected(false);
    setMeta(`${rawKeyBytes ? matchCode(rawKeyBytes) : ""} • Ended`.trim());
    addSys("Ended.");
  });

  $("lockBtn").addEventListener("click", lockNow);
})();
