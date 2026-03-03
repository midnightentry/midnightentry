const PIN_HASH = "7377a71607a8dabc029ab10e7a6a895b92e87762538b10ce8b10c4c9ddc74448";
const $ = (id) => document.getElementById(id);

let ws = null;
let aesKey = null;
let roomId = "";
let rawKeyBytes = null;

let ended = false;
let reconnectTimer = null;
let reconnectAttempt = 0;

// WebRTC
let pc = null;
let localStream = null;
let remoteStream = null;
let inCall = false;
let pendingOffer = null;

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

function setMeta(text){ $("meta").textContent = text; }

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

function setConnectedUI(isConnected){
  $("send").disabled = !isConnected;
  $("text").disabled = !isConnected;
}

function clearReconnect(){
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(){
  if (ended) return;
  if (reconnectTimer) return;

  reconnectAttempt += 1;
  const delay = Math.min(12000, 900 + reconnectAttempt * 900);

  setMeta(`${matchCode(rawKeyBytes)} • Reconnecting…`);
  addSys("Reconnecting…");

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectWs(true);
  }, delay);
}

function wsSend(obj){
  try { ws && ws.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {}
}

async function connectWs(isReconnect=false){
  if (!aesKey || !roomId) return;

  clearReconnect();
  setConnectedUI(false);

  try { if (ws) ws.close(); } catch {}
  ws = null;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${proto}://${location.host}/?room=${encodeURIComponent(roomId)}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    setConnectedUI(true);
    setMeta(`${matchCode(rawKeyBytes)} • Connected`);
    addSys(isReconnect ? "Reconnected." : "Connected.");
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
        setConnectedUI(false);
        setMeta(`${matchCode(rawKeyBytes)} • Ended`);
        addSys("Session ended.");
        $("log").innerHTML = "";
        await endCall(true);
        return;
      }
    }

    if (msg.type === "msg") {
      try{
        const obj = await decryptJson(aesKey, msg.iv, msg.ct);
        if (obj && typeof obj.text === "string") addMsg(obj.text, false);
      } catch {}
      return;
    }

    if (msg.type === "rtc") {
      await handleRtc(msg.kind, msg.data);
      return;
    }
  });

  ws.addEventListener("close", (e) => {
    setConnectedUI(false);
    if (ended) return;

    const reason = (e && e.reason) ? String(e.reason) : "";

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

    scheduleReconnect();
  });

  ws.addEventListener("error", () => setConnectedUI(false));

  setInterval(() => wsSend({ type:"ping" }), 25000);
}

async function sendText(){
  if (!ws || ws.readyState !== 1 || !aesKey) return;

  const text = ($("text").value || "").trim();
  if (!text) return;
  $("text").value = "";

  addMsg(text, true);

  const enc = await encryptJson(aesKey, { text, ts: Date.now() });
  wsSend({ type:"msg", iv: enc.iv, ct: enc.ct });
}

/* =========================
   ⋯ menu
   ========================= */
function closeMenu(){
  $("menuMask").style.display = "none";
  $("menu").style.display = "none";
}
function openMenu(){
  $("menuMask").style.display = "block";
  $("menu").style.display = "block";
}
$("menuBtn").addEventListener("click", () => {
  if ($("menu").style.display === "block") closeMenu();
  else openMenu();
});
$("menuMask").addEventListener("click", closeMenu);

/* =========================
   Calls: WebRTC (audio/video)
   ========================= */

function showCallUI(show){
  $("callWrap").style.display = show ? "block" : "none";
}

function setCallStatus(t){
  $("callStatus").textContent = t;
}

function makePeerConnection(){
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });

  remoteStream = new MediaStream();
  $("remoteVideo").srcObject = remoteStream;

  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      wsSend({ type:"rtc", kind:"ice", data: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") {
      inCall = true;
      setCallStatus("In call");
      setMeta(`${matchCode(rawKeyBytes)} • In call`);
      addSys("Call connected.");
    }
  };
}

async function startCall({ video }){
  closeMenu();
  if (!ws || ws.readyState !== 1) return addSys("Not connected.");
  if (inCall) return;

  try{
    localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video: !!video });
  } catch {
    addSys("Microphone/camera blocked.");
    return;
  }

  makePeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  $("localVideo").srcObject = localStream;
  showCallUI(true);

  setCallStatus(video ? "Calling (video)…" : "Calling (audio)…");
  setMeta(`${matchCode(rawKeyBytes)} • Calling…`);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  wsSend({ type:"rtc", kind:"offer", data: { sdp: offer.sdp, type: offer.type, video: !!video } });
}

async function handleRtc(kind, data){
  if (kind === "hangup") {
    addSys("Call ended.");
    await endCall(true);
    setMeta(`${matchCode(rawKeyBytes)} • Connected`);
    return;
  }

  if (kind === "offer") {
    if (inCall) return;
    pendingOffer = data;
    addSys(data?.video ? "Incoming video call…" : "Incoming audio call…");
    // auto-accept to keep it simple/discreet
    await acceptOffer();
    return;
  }

  if (kind === "answer") {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    return;
  }

  if (kind === "ice") {
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch {}
    return;
  }
}

async function acceptOffer(){
  if (!pendingOffer) return;

  try{
    localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video: !!pendingOffer.video });
  } catch {
    addSys("Microphone/camera blocked.");
    pendingOffer = null;
    return;
  }

  makePeerConnection();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  $("localVideo").srcObject = localStream;
  showCallUI(true);

  setCallStatus(pendingOffer.video ? "Answering (video)…" : "Answering (audio)…");

  await pc.setRemoteDescription(new RTCSessionDescription({ type:"offer", sdp: pendingOffer.sdp }));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  wsSend({ type:"rtc", kind:"answer", data: { sdp: answer.sdp, type: answer.type } });

  inCall = true;
  setCallStatus("In call");
  setMeta(`${matchCode(rawKeyBytes)} • In call`);
  pendingOffer = null;
}

async function endCall(silent){
  if (pc) {
    try { pc.ontrack = null; pc.onicecandidate = null; } catch {}
  }

  if (localStream) {
    localStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
  }

  pc = null;
  localStream = null;
  remoteStream = null;
  inCall = false;
  pendingOffer = null;

  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  showCallUI(false);

  if (!silent) {
    wsSend({ type:"rtc", kind:"hangup", data:{} });
    addSys("Call ended.");
  }
}

$("audioCall").addEventListener("click", () => startCall({ video:false }));
$("videoCall").addEventListener("click", () => startCall({ video:true }));
$("hangCall").addEventListener("click", async () => {
  closeMenu();
  await endCall(false);
  setMeta(`${matchCode(rawKeyBytes)} • Connected`);
});

/* =========================
   Lock / Unlock
   ========================= */
function lockNow(){
  sessionStorage.removeItem("unlocked");
  ended = true;
  clearReconnect();
  try { ws && ws.close(); } catch {}
  ws = null;

  $("log").innerHTML = "";
  setConnectedUI(false);
  setMeta("Locked…");
  $("modal").style.display = "grid";

  endCall(true);
}

async function unlockFlow(){
  const pin = ($("pin").value || "").trim();
  const pass = ($("pass").value || "").trim();
  if (!pin || !pass) return;

  const h = await sha256Hex(pin);
  if (h !== PIN_HASH) {
    $("modal").style.display = "none";
    addSys(" ");
    return;
  }

  const k = keyFromHash();
  const linkKey = b64urlToBytes(k);
  if (linkKey.length !== 32) {
    setMeta("Invalid link");
    addSys("Invalid link.");
    return;
  }

  const raw = await deriveKey(linkKey, pass, roomId);
  rawKeyBytes = raw;
  aesKey = await importAesKey(raw);

  $("modal").style.display = "none";
  ended = false;
  setMeta(`${matchCode(rawKeyBytes)} • Connecting…`);
  await connectWs(false);
}

/* Emoji row */
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

(async function main(){
  initEmojiRow();

  roomId = roomIdFromPath();
  if (!roomId || !/^[a-zA-Z0-9_-]{6,64}$/.test(roomId)) {
    setMeta("Invalid");
    addSys("Invalid link.");
    setConnectedUI(false);
    return;
  }

  if (!keyFromHash()) {
    setMeta("Missing key");
    addSys("Missing key.");
    setConnectedUI(false);
    return;
  }

  setMeta("Locked…");
  setConnectedUI(false);
  $("modal").style.display = "grid";

  $("go").addEventListener("click", unlockFlow);
  $("pass").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockFlow(); });
  $("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockFlow(); });

  $("send").addEventListener("click", sendText);
  $("text").addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });

  $("endBtn").addEventListener("click", async () => {
    ended = true;
    clearReconnect();
    wsSend({ type:"end" });
    try { ws && ws.close(); } catch {}
    ws = null;

    $("log").innerHTML = "";
    setConnectedUI(false);
    setMeta(`${rawKeyBytes ? matchCode(rawKeyBytes) : ""} • Ended`.trim());
    addSys("Ended.");
    await endCall(true);
  });

  $("lockBtn").addEventListener("click", lockNow);
})();
