// Quackers text-chat panel — a little iMessage-with-a-duck that hovers next to
// the body and follows it. The conversation itself lives in the main process
// (chat.js there, same brain + memory + digest as voice); this file is only the
// surface: a scrolling thread, a text box, and the duck's live-typed replies.
//
// One relationship, two mouths: nothing here starts a "new chat" — the duck
// remembers everything through the shared memory, so an empty panel is still a
// continuous friendship, not a blank slate.

(() => {
  const PANEL_W = 300;
  const GAP = 14; // px between the duck and the panel

  let open = false;
  let root = null;
  let threadEl = null;
  let inputEl = null;
  let followRaf = null;
  let liveEl = null; // the duck bubble currently being streamed into
  let panelRect = { left: 0, top: 0, right: 0, bottom: 0 };

  // ---- styling (self-contained; warm paper to match the duck's bubbles) ----
  function injectStyles() {
    if (document.getElementById('chat-styles')) return;
    const css = `
      #chat { position: fixed; width: ${PANEL_W}px; z-index: 50; display: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-user-select: none; user-select: none; }
      #chat.open { display: flex; flex-direction: column; }
      #chat .thread { max-height: 46vh; overflow-y: auto; padding: 10px 10px 4px;
        display: flex; flex-direction: column; gap: 6px; scrollbar-width: thin; }
      #chat .thread::-webkit-scrollbar { width: 6px; }
      #chat .thread::-webkit-scrollbar-thumb { background: rgba(90,70,40,.25); border-radius: 3px; }
      #chat .wrap { background: rgba(246,241,227,.97); border-radius: 16px;
        box-shadow: 0 10px 34px rgba(40,28,10,.32); border: 1px solid rgba(120,95,55,.18);
        backdrop-filter: blur(3px); overflow: hidden; }
      #chat .bubble { max-width: 84%; padding: 7px 11px; border-radius: 14px; font-size: 13.5px;
        line-height: 1.35; white-space: pre-wrap; word-wrap: break-word; animation: pop .14s ease-out; }
      #chat .bubble.duck { align-self: flex-start; background: #fff8e9; color: #3a2c17;
        border-bottom-left-radius: 5px; }
      #chat .bubble.me { align-self: flex-end; background: #6ea8fe; color: #fff;
        border-bottom-right-radius: 5px; }
      #chat .bubble.note { align-self: center; background: transparent; color: rgba(90,70,40,.7);
        font-size: 11.5px; padding: 2px 8px; font-style: italic; }
      #chat .dots span { display: inline-block; width: 5px; height: 5px; margin: 0 1.5px; border-radius: 50%;
        background: #b09a6e; animation: blink 1.1s infinite; }
      #chat .dots span:nth-child(2) { animation-delay: .2s; }
      #chat .dots span:nth-child(3) { animation-delay: .4s; }
      #chat .row { display: flex; align-items: flex-end; gap: 6px; padding: 7px 8px 8px;
        border-top: 1px solid rgba(120,95,55,.14); }
      #chat textarea { flex: 1; resize: none; border: none; outline: none; background: rgba(255,255,255,.7);
        border-radius: 12px; padding: 7px 10px; font: inherit; font-size: 13.5px; color: #3a2c17;
        max-height: 90px; line-height: 1.3; }
      #chat textarea::placeholder { color: #a9946a; }
      #chat .send { border: none; background: #6ea8fe; color: #fff; border-radius: 50%;
        width: 30px; height: 30px; font-size: 15px; cursor: pointer; flex: 0 0 auto; line-height: 30px; }
      #chat .send:disabled { opacity: .4; cursor: default; }
      #chat .close { position: absolute; top: 6px; right: 8px; border: none; background: transparent;
        color: rgba(90,70,40,.55); font-size: 15px; cursor: pointer; line-height: 1; padding: 2px 4px; z-index: 2; }
      @keyframes pop { from { transform: translateY(3px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes blink { 0%,60%,100% { opacity: .3; } 30% { opacity: 1; } }
    `;
    const style = document.createElement('style');
    style.id = 'chat-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function build() {
    injectStyles();
    root = document.createElement('div');
    root.id = 'chat';
    root.innerHTML = `
      <div class="wrap">
        <button class="close" title="close">×</button>
        <div class="thread"></div>
        <div class="row">
          <textarea rows="1" placeholder="text Quackers…"></textarea>
          <button class="send" title="send">↑</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    threadEl = root.querySelector('.thread');
    inputEl = root.querySelector('textarea');
    const sendBtn = root.querySelector('.send');

    root.querySelector('.close').addEventListener('click', () => close());
    sendBtn.addEventListener('click', submit);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    inputEl.addEventListener('input', autoGrow);
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(90, inputEl.scrollHeight) + 'px';
  }

  // ---- bubbles ----
  function addBubble(cls, text) {
    const el = document.createElement('div');
    el.className = `bubble ${cls}`;
    el.textContent = text;
    threadEl.appendChild(el);
    scrollDown();
    return el;
  }

  function addTypingBubble() {
    const el = document.createElement('div');
    el.className = 'bubble duck dots';
    el.innerHTML = '<span></span><span></span><span></span>';
    el.dataset.typing = '1';
    threadEl.appendChild(el);
    scrollDown();
    return el;
  }

  function scrollDown() {
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function setBusy(busy) {
    if (!inputEl) return;
    root.querySelector('.send').disabled = busy;
  }

  function submit() {
    if (root.querySelector('.send').disabled) return; // duck is mid-reply — don't drop the turn
    const text = inputEl.value.trim();
    if (!text) return;
    addBubble('me', text);
    inputEl.value = '';
    autoGrow();
    setBusy(true);
    window.quackers.chatSend(text);
  }

  // ---- positioning: hover next to the duck and follow it ----
  function follow() {
    if (!open) return;
    const r = window.duckAPI && window.duckAPI.duckRect ? window.duckAPI.duckRect() : null;
    if (r) {
      const center = (r.left + r.right) / 2;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = center - PANEL_W / 2;
      left = Math.max(8, Math.min(vw - PANEL_W - 8, left));
      const h = root.offsetHeight || 200;
      // prefer sitting above the duck; drop below if there isn't room up top
      let top = r.top - h - GAP;
      if (top < 8) top = Math.min(vh - h - 8, r.bottom + GAP);
      root.style.left = `${Math.round(left)}px`;
      root.style.top = `${Math.round(top)}px`;
      panelRect = { left, top, right: left + PANEL_W, bottom: top + h };
    }
    followRaf = requestAnimationFrame(follow);
  }

  // ---- open / close ----
  function open_() {
    if (open) return;
    if (!root) build();
    open = true;
    threadEl.innerHTML = '';
    liveEl = null;
    root.classList.add('open');
    setBusy(true); // stays disabled until the greeting settles (chat-idle)
    if (window.duckAPI && window.duckAPI.setChatting) window.duckAPI.setChatting(true);
    follow();
    window.quackers.chatOpen().then((r) => {
      if (r && r.error) {
        // keyless install — nothing to chat with yet
        addBubble('note', 'I need an API key before I can chat — add one and try again.');
        if (window.quackers.openKeyWindow) window.quackers.openKeyWindow();
      }
    });
    setTimeout(() => inputEl && inputEl.focus(), 60);
  }

  // `fromMain` = main already tore the session down (end_chat / switch), so we
  // must NOT invoke chatClose again (it would double-digest).
  function close(fromMain = false) {
    if (!open) return;
    open = false;
    root.classList.remove('open');
    if (followRaf) cancelAnimationFrame(followRaf);
    followRaf = null;
    liveEl = null;
    if (window.duckAPI && window.duckAPI.setChatting) window.duckAPI.setChatting(false);
    if (!fromMain) window.quackers.chatClose();
  }

  // ---- streamed replies ----
  window.quackers.onChatTyping((on) => {
    if (!open) return;
    if (on) {
      if (!liveEl) liveEl = addTypingBubble();
    } else if (liveEl && liveEl.dataset.typing) {
      // typing ended with no text (a tool-only turn) — drop the dots
      liveEl.remove();
      liveEl = null;
    }
  });

  window.quackers.onChatDelta((d) => {
    if (!open) return;
    if (!liveEl) liveEl = addBubble('duck', '');
    if (liveEl.dataset.typing) { liveEl.className = 'bubble duck'; delete liveEl.dataset.typing; liveEl.textContent = ''; }
    liveEl.textContent += d;
    scrollDown();
  });

  // finalize the turn — split on blank lines so the duck can send a couple of
  // little bubbles in one breath (the override tells it to do exactly that)
  window.quackers.onChatTurnEnd((text) => {
    if (!open) return;
    if (liveEl) { liveEl.remove(); liveEl = null; }
    const parts = String(text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) addBubble('duck', p);
  });

  window.quackers.onChatEmote((emotion) => {
    if (window.duckAPI && window.duckAPI.emote) window.duckAPI.emote(emotion);
  });

  window.quackers.onChatLooking((on) => {
    if (!open) return;
    if (on) addBubble('note', '👀 looking at your screen…');
  });

  window.quackers.onChatIdle(() => { if (open) { setBusy(false); inputEl && inputEl.focus(); } });

  window.quackers.onChatClose(() => close(true));
  window.quackers.onChatSwitchVoice(() => {
    close(true);
    if (window.voiceToggle) window.voiceToggle();
  });

  // entry from the tray / hotkey (main → renderer)
  window.quackers.onChatRequest(() => open_());

  // public handle for voice.js (switch_to_chat) and pet.js (interactive region)
  window.chatAPI = {
    open: open_,
    close: () => close(),
    overPanel(x, y) {
      return open && x >= panelRect.left && x <= panelRect.right && y >= panelRect.top && y <= panelRect.bottom;
    },
  };
})();
