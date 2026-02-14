<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>For Bae 💌</title>
  <style>
    body{
      margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(circle at top, #ffe1ec, #fff);
      color:#222;
    }
    .card{
      width:min(620px, 92vw);
      background:rgba(255,255,255,0.88);
      border:1px solid rgba(0,0,0,0.06);
      border-radius:24px;
      padding:28px 22px;
      box-shadow: 0 18px 60px rgba(0,0,0,0.08);
      text-align:center;
      position:relative;
      overflow:hidden;
    }

    /* Floating hearts layer */
    .float-layer{
      position:absolute;
      inset:0;
      pointer-events:none;
      overflow:hidden;
      z-index:0;
    }
    .card > *:not(.float-layer){
      position:relative;
      z-index:1;
    }
    .heart{
      position:absolute;
      bottom:-30px;
      font-size:18px;
      opacity:0.85;
      animation: floatUp linear forwards;
      filter: drop-shadow(0 6px 10px rgba(0,0,0,0.10));
    }
    @keyframes floatUp{
      0%   { transform: translateY(0) translateX(0) rotate(0deg); opacity:0; }
      10%  { opacity:0.9; }
      100% { transform: translateY(-120vh) translateX(var(--drift)) rotate(var(--spin)); opacity:0; }
    }

    .hearts{ font-size:28px; letter-spacing:6px; margin-bottom:10px; }
    h1{ font-size:34px; margin:8px 0 6px; }
    p{ font-size:16px; line-height:1.5; margin:0 0 16px; color:#333; }
    .name{ font-weight:800; }
    .btns{ display:flex; gap:12px; justify-content:center; margin-top:18px; flex-wrap:wrap; }
    button{
      border:0; border-radius:999px; padding:12px 18px; font-size:16px; cursor:pointer;
      box-shadow: 0 10px 20px rgba(0,0,0,0.10);
      transition: transform 0.08s ease;
      user-select:none;
    }
    button:active{ transform: scale(0.98); }
    #yes{ background:#ff3b7a; color:white; }
    #no{
      background:#f2f2f2; color:#222;
      position:relative;
    }
    .hidden{ display:none; }
    .success{
      margin-top:16px;
      padding:16px;
      border-radius:18px;
      background:#fff0f6;
      border:1px solid rgba(255, 59, 122, 0.18);
      text-align:left;
    }
    .success h2{ margin:0 0 10px; text-align:center; }
    .pill{
      display:inline-block;
      padding:6px 10px;
      border-radius:999px;
      background:white;
      border:1px solid rgba(0,0,0,0.08);
      margin:6px 6px 0 0;
      font-size:13px;
    }
    .center{ text-align:center; }
    .footer{
      margin-top:16px;
      font-size:12.5px;
      color:#666;
    }
    .mono{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
  </style>
</head>

<body>
  <div class="card">
    <div class="float-layer" aria-hidden="true"></div>

    <div class="hearts">💗 💞 💘</div>

    <h1>Hey <span class="name">Bae</span>…</h1>
    <p>
      Okay listen… I tried to be normal and just ask, but my spirit said: "make a website." 😭<br><br>
      So, <span class="name">Kelani</span>… will you be my Valentine? 💌
    </p>

    <p id="countdown" style="margin:10px 0 0; font-weight:700;">
      Countdown to Valentine's Day: …
    </p>
    <p style="margin:6px 0 0; font-size:14px; font-style:italic;">
      Bae… choose wisely 😭💗
    </p>

    <div class="btns">
      <button id="yes">Yes 💖</button>
      <button id="no">No 🙃</button>
    </div>

    <div id="success" class="success hidden">
      <h2>YUUUP!! That's my Bae 😭💘</h2>

      <p class="center" style="margin:0 0 10px;">
        No pressure for a big date btw…<br>
        I just want us to do a cute little <strong>gift exchange</strong> 💝
      </p>

      <div class="center" style="margin:10px 0 6px;">
        <span class="pill">Flowers? 🌸</span>
        <span class="pill">Snacks? 🍫</span>
        <span class="pill">Something soft? 🧸</span>
        <span class="pill">A lil note? 💌</span>
      </div>

      <p style="margin:12px 0 10px;">
        Text me this so I know it's real:
        <span class="mono"><strong>"Much appreciated, Bianca 🧍🏾‍♀️💖"</strong></span>
      </p>

      <p style="margin:0;">
        (Also… you look good today. Yes, even if you're reading this in bonnet. 😌)
      </p>
    </div>

    <div class="footer">
      Made with love + mischief by Bianca 💌
    </div>
  </div>

  <script>
    // Floating hearts ✨
    const floatLayer = document.querySelector('.float-layer');
    const heartChars = ["💗","💞","💘","💕","💖"];

    function spawnHeart(){
      if(!floatLayer) return;

      const h = document.createElement('div');
      h.className = 'heart';
      h.textContent = heartChars[Math.floor(Math.random()*heartChars.length)];

      const left = Math.random() * 100;
      h.style.left = left + '%';

      const size = 14 + Math.random() * 18; // 14–32px
      h.style.fontSize = size + 'px';

      const duration = 4 + Math.random() * 4; // 4–8s
      h.style.animationDuration = duration + 's';

      const drift = (Math.random() * 120 - 60) + 'px'; // -60 to +60
      const spin = (Math.random() * 120 - 60) + 'deg'; // -60 to +60
      h.style.setProperty('--drift', drift);
      h.style.setProperty('--spin', spin);

      floatLayer.appendChild(h);
      setTimeout(() => h.remove(), (duration * 1000) + 300);
    }
    setInterval(spawnHeart, 350);

    // Buttons + countdown
    const noBtn = document.getElementById('no');
    const yesBtn = document.getElementById('yes');
    const success = document.getElementById('success');
    const countdownEl = document.getElementById('countdown');

    // Countdown to Feb 14, 2026 (local time)
    const target = new Date(2026, 1, 14, 0, 0, 0); // month is 0-based

    function updateCountdown(){
      const now = new Date();
      let diff = target - now;

      if (!countdownEl) return;

      if (diff <= 0){
        countdownEl.textContent = "It's Valentine's Day 😭💘";
        return;
      }

      const totalSeconds = Math.floor(diff / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const pad = (n) => String(n).padStart(2, '0');

      if (days > 0){
        countdownEl.textContent = `Countdown to Valentine's Day: ${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s 💘`;
      } else {
        countdownEl.textContent = `Countdown to Valentine's Day: ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s 💘`;
      }
    }
    setInterval(updateCountdown, 1000);
    updateCountdown();

    function moveNo(){
      const card = document.querySelector('.card');
      const rect = card.getBoundingClientRect();
      const btnRect = noBtn.getBoundingClientRect();

      const padding = 18;
      const maxX = rect.width - btnRect.width - padding;
      const maxY = rect.height - btnRect.height - padding;

      const x = Math.max(padding, Math.floor(Math.random() * maxX));
      const y = Math.max(padding, Math.floor(Math.random() * maxY));

      noBtn.style.position = 'absolute';
      noBtn.style.left = x + 'px';
      noBtn.style.top = y + 'px';
    }

    noBtn.addEventListener('mouseenter', moveNo);
    noBtn.addEventListener('click', moveNo);

    yesBtn.addEventListener('click', () => {
      success.classList.remove('hidden');
      yesBtn.textContent = "Yes 💖 (locked in)";
      noBtn.style.display = 'none';
    });
  </script>
</body>
</html>