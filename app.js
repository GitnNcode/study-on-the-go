// ════════════════════════════════════════
// DriveTrivia — Quiz Logic
// ════════════════════════════════════════

const LABELS = ['A', 'B', 'C', 'D'];

let S = {
  mode: 'topic',       // 'topic', 'study', or 'askme'
  topic: '',
  length: 10,
  questions: [],
  idx: 0,
  correct: 0,
  streak: 0,
  bestStreak: 0,
  attempts: [],
  listening: false,
  recog: null,
  skipped: false,
  quitting: false,
  pdfText: '',         // extracted PDF text
  pdfName: '',
  // Ask Me state
  askmeMessages: [],   // multi-turn conversation [{role, content}]
  askmeContext: '',     // PDF text for grounding
  askmePdfName: '',
  askmeBusy: false,
};

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setModel('claude-haiku-4-5-20251001');
  setLength(10);
  checkBrowser();
  await ClaudeAPI.loadConfig();
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
});

function checkBrowser() {
  const ok = ('speechSynthesis' in window) && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  if (!ok) {
    const btn = document.getElementById('btnStart');
    btn.disabled = true;
    btn.textContent = 'Speech not supported — use Chrome';
    btn.classList.add('opacity-40', 'cursor-not-allowed');
  }
}

// ════════════════════════════════════════
// VOICE TOPIC INPUT
// ════════════════════════════════════════
function voiceTopic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  const btn = document.getElementById('btnVoiceTopic');
  const input = document.getElementById('topicInput');
  const r = new SR();
  r.continuous = false;
  r.interimResults = true;
  r.lang = 'en-US';

  // Visual feedback — glow while listening
  btn.classList.add('border-glow/40', 'text-glow');
  btn.disabled = true;

  r.onresult = e => {
    let transcript = '';
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    input.value = transcript;
  };

  r.onend = () => {
    btn.classList.remove('border-glow/40', 'text-glow');
    btn.disabled = false;
  };

  r.onerror = () => {
    btn.classList.remove('border-glow/40', 'text-glow');
    btn.disabled = false;
  };

  r.start();
}

function voiceFocus() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  const input = document.getElementById('focusInput');
  const r = new SR();
  r.continuous = false;
  r.interimResults = true;
  r.lang = 'en-US';

  r.onresult = e => {
    let transcript = '';
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    input.value = transcript;
  };
  r.onend = () => {};
  r.onerror = () => {};
  r.start();
}

// ════════════════════════════════════════
// MODE SWITCHING
// ════════════════════════════════════════
function switchMode(mode) {
  S.mode = mode;
  const tabs = { topic: 'tabTopic', study: 'tabStudy', askme: 'tabAskMe' };
  const fields = { topic: 'topicFields', study: 'studyFields', askme: 'askmeFields' };
  const activeClass = 'mode-tab flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border-glow/30 bg-glow/10 text-glow';
  const inactiveClass = 'mode-tab flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-muted hover:text-soft';

  for (const [m, tabId] of Object.entries(tabs)) {
    document.getElementById(tabId).className = m === mode ? activeClass : inactiveClass;
  }
  for (const [m, fieldId] of Object.entries(fields)) {
    document.getElementById(fieldId).classList.toggle('hidden', m !== mode);
  }

  // Show/hide length picker (not relevant for askme)
  const lengthPicker = document.getElementById('lengthPicker');
  if (lengthPicker) lengthPicker.classList.toggle('hidden', mode === 'askme');

  // Update start button text
  const btn = document.getElementById('btnStart');
  btn.textContent = mode === 'askme' ? 'Start Asking' : 'Generate & Start';

  if (mode === 'study') initDropZone();
  if (mode === 'askme') initAskmeDropZone();
}

// ════════════════════════════════════════
// PDF HANDLING
// ════════════════════════════════════════
let dropZoneInitialized = false;

function initDropZone() {
  if (dropZoneInitialized) return;
  dropZoneInitialized = true;

  const zone = document.getElementById('dropZone');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      processPDF(file);
    } else {
      showError('Please upload a PDF file.');
    }
  });
}

function handlePDFSelect(event) {
  const file = event.target.files[0];
  if (file) processPDF(file);
}

async function processPDF(file) {
  const dropZone = document.getElementById('dropZone');
  const fileInfo = document.getElementById('pdfFileInfo');
  const dropLabel = document.getElementById('dropLabel');

  dropLabel.textContent = 'Reading PDF...';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      text += pageText + '\n\n';
    }

    text = text.trim();
    if (!text || text.length < 50) {
      showError('Could not extract enough text from this PDF. It may be image-based or scanned.');
      dropLabel.innerHTML = 'Drop a PDF here or <span class="text-glow">click to browse</span>';
      return;
    }

    S.pdfText = text;
    S.pdfName = file.name;

    // Show file info, hide drop zone
    dropZone.classList.add('hidden');
    fileInfo.classList.remove('hidden');
    document.getElementById('pdfFileName').textContent = file.name;
    document.getElementById('pdfPageCount').textContent = `${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}`;

  } catch (err) {
    showError('Failed to read PDF: ' + (err.message || 'Unknown error'));
    dropLabel.innerHTML = 'Drop a PDF here or <span class="text-glow">click to browse</span>';
  }
}

function clearPDF() {
  S.pdfText = '';
  S.pdfName = '';
  document.getElementById('dropZone').classList.remove('hidden');
  document.getElementById('pdfFileInfo').classList.add('hidden');
  document.getElementById('pdfFileInput').value = '';
  document.getElementById('dropLabel').innerHTML = 'Drop a PDF here or <span class="text-glow">click to browse</span>';
}

// ════════════════════════════════════════
// MODEL PICKER
// ════════════════════════════════════════
const MODEL_IDS = {
  'claude-haiku-4-5-20251001': 'modelHaiku',
  'claude-sonnet-4-6': 'modelSonnet',
  'claude-opus-4-6': 'modelOpus',
};

function setModel(modelId) {
  ClaudeAPI.configure({ model: modelId });
  for (const [id, btnId] of Object.entries(MODEL_IDS)) {
    const btn = document.getElementById(btnId);
    if (id === modelId) {
      btn.className = 'model-btn px-3 py-1.5 rounded-lg text-xs font-mono border border-glow/30 bg-glow/8 text-glow transition-all';
    } else {
      btn.className = 'model-btn px-3 py-1.5 rounded-lg text-xs font-mono border border-white/5 bg-panel/40 text-muted hover:border-white/10 transition-all';
    }
  }
}

// ════════════════════════════════════════
// LENGTH PICKER
// ════════════════════════════════════════
function setLength(n) {
  S.length = n;
  [5, 10, 15].forEach(v => {
    const btn = document.getElementById('len' + v);
    if (v === n) {
      btn.className = 'len-btn px-3 py-1.5 rounded-lg text-xs font-mono border border-glow/30 bg-glow/8 text-glow transition-all';
    } else {
      btn.className = 'len-btn px-3 py-1.5 rounded-lg text-xs font-mono border border-white/5 bg-panel/40 text-muted hover:border-white/10 transition-all';
    }
  });
}

// ════════════════════════════════════════
// TTS
// ════════════════════════════════════════

// Prefer enhanced/premium voices — they use neural TTS on macOS & Chrome
function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  const en = voices.filter(v => v.lang.startsWith('en'));

  // 1. macOS "Premium" / "Enhanced" voices (neural quality)
  const premium = en.find(v => /premium|enhanced/i.test(v.name));
  if (premium) return premium;

  // 2. Specific high-quality macOS voices (Zoe, Samantha, Karen, Daniel)
  const preferred = ['Zoe', 'Samantha', 'Karen', 'Daniel', 'Serena', 'Moira'];
  for (const name of preferred) {
    const match = en.find(v => v.name.includes(name));
    if (match) return match;
  }

  // 3. Google voices in Chrome — smoother than default
  const google = en.find(v => /google/i.test(v.name));
  if (google) return google;

  // 4. Any local English voice
  return en.find(v => v.localService) || en[0] || null;
}

// Convert math/science notation to spoken English for TTS
function normalizeTTSText(text) {
  let t = text;

  // ── Greek letters (lowercase & uppercase) ──
  const greek = {
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa',
    'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi',
    'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi',
    'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
    'Α': 'Alpha', 'Β': 'Beta', 'Γ': 'Gamma', 'Δ': 'delta', 'Ε': 'Epsilon',
    'Ζ': 'Zeta', 'Η': 'Eta', 'Θ': 'Theta', 'Ι': 'Iota', 'Κ': 'Kappa',
    'Λ': 'Lambda', 'Μ': 'Mu', 'Ν': 'Nu', 'Ξ': 'Xi', 'Π': 'Pi',
    'Ρ': 'Rho', 'Σ': 'Sigma', 'Τ': 'Tau', 'Υ': 'Upsilon', 'Φ': 'Phi',
    'Χ': 'Chi', 'Ψ': 'Psi', 'Ω': 'Omega',
  };
  for (const [sym, name] of Object.entries(greek)) {
    t = t.replaceAll(sym, ` ${name} `);
  }

  // ── Superscript digits → exponent words ──
  // Handle multi-digit superscripts like ⁻¹ or ⁴⁵
  const supDigits = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, match => {
    const num = [...match].map(c => supDigits[c] || c).join('');
    if (num === '2') return ' squared';
    if (num === '3') return ' cubed';
    if (num === '-1') return ' inverse';
    if (num === '-2') return ' to the negative 2';
    return ` to the ${num}`;
  });

  // ── Subscript digits → spoken digits ──
  const subDigits = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-' };
  t = t.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋]+/g, match => {
    const num = [...match].map(c => subDigits[c] || c).join('');
    return ` ${num} `;
  });

  // ── Caret exponents: x^2, x^{-1}, x^10 ──
  t = t.replace(/\^{?\s*(-?\d+)\s*}?/g, (_, exp) => {
    if (exp === '2') return ' squared';
    if (exp === '3') return ' cubed';
    if (exp === '-1') return ' inverse';
    return ` to the ${exp}`;
  });

  // ── Common compound formulas (before general symbol replacement) ──
  // Chemical formulas like CO2, H2O, NaCl, CH4 etc. — letter followed by digit
  t = t.replace(/([A-Z][a-z]?)(\d)/g, '$1 $2 ');

  // ── Fractions & division ──
  t = t.replace(/(\w+)\s*\/\s*(\w+)/g, '$1 over $2');      // a/b → a over b
  t = t.replace(/½/g, ' one half ').replace(/⅓/g, ' one third ').replace(/¼/g, ' one quarter ');
  t = t.replace(/⅔/g, ' two thirds ').replace(/¾/g, ' three quarters ');

  // ── Math operators & symbols ──
  t = t.replace(/≥/g, ' greater than or equal to ');
  t = t.replace(/≤/g, ' less than or equal to ');
  t = t.replace(/≠/g, ' not equal to ');
  t = t.replace(/≈/g, ' approximately equal to ');
  t = t.replace(/∝/g, ' proportional to ');
  t = t.replace(/±/g, ' plus or minus ');
  t = t.replace(/∓/g, ' minus or plus ');
  t = t.replace(/×/g, ' times ');
  t = t.replace(/÷/g, ' divided by ');
  t = t.replace(/·/g, ' times ');
  t = t.replace(/∞/g, ' infinity ');
  t = t.replace(/∂/g, ' partial ');
  t = t.replace(/∇/g, ' del ');
  t = t.replace(/∑/g, ' the sum of ');
  t = t.replace(/∏/g, ' the product of ');
  t = t.replace(/∫/g, ' the integral of ');
  t = t.replace(/√/g, ' the square root of ');
  t = t.replace(/∛/g, ' the cube root of ');
  t = t.replace(/°/g, ' degrees ');
  t = t.replace(/‰/g, ' per mille ');

  // ── Arrows ──
  t = t.replace(/⟶/g, ' yields ').replace(/→/g, ' goes to ').replace(/←/g, ' comes from ');
  t = t.replace(/⇌/g, ' is in equilibrium with ').replace(/⇒/g, ' implies ').replace(/⇔/g, ' if and only if ');
  t = t.replace(/↑/g, ' up ').replace(/↓/g, ' down ');

  // ── Set/logic notation ──
  t = t.replace(/∈/g, ' is an element of ').replace(/∉/g, ' is not an element of ');
  t = t.replace(/⊂/g, ' is a subset of ').replace(/⊃/g, ' is a superset of ');
  t = t.replace(/∪/g, ' union ').replace(/∩/g, ' intersection ');
  t = t.replace(/∅/g, ' the empty set ');
  t = t.replace(/∀/g, ' for all ').replace(/∃/g, ' there exists ');
  t = t.replace(/¬/g, ' not ').replace(/∧/g, ' and ').replace(/∨/g, ' or ');

  // ── Equals sign (only between word/number boundaries, not in URLs etc.) ──
  t = t.replace(/(\w)\s*=\s*(\w)/g, '$1 equals $2');

  // ── Lone symbols that TTS might choke on ──
  t = t.replace(/\|/g, ' absolute value of ');

  // ── Clean up spaces ──
  t = t.replace(/\s{2,}/g, ' ').trim();

  // ── Separate single letters so TTS doesn't merge them ──
  // "F equals m a" → "F, equals m, a" — commas force the engine to pause between letters
  // Match a lone single letter (A-Z or a-z) followed by space and another lone single letter
  t = t.replace(/(?<![a-zA-Z])([a-zA-Z]) ([a-zA-Z])(?![a-zA-Z])/g, '$1, $2');
  // Run twice to catch chains like "m a x" (first pass: "m, a x", second: "m, a, x")
  t = t.replace(/(?<![a-zA-Z])([a-zA-Z]) ([a-zA-Z])(?![a-zA-Z])/g, '$1, $2');

  // ── Strip periods/ellipsis the TTS might read as "full stop" or "dot" ──
  t = t.replace(/\.{2,}/g, ',');   // "..." or ".." → comma (pause without speech)
  t = t.replace(/\.\s*$/g, '');    // trailing period — sentence pause handled by chunking
  t = t.replace(/\.\s+/g, ', ');   // mid-text periods → commas (keeps a pause, won't say "full stop")

  return t;
}

function speak(text, { emotion = 'neutral' } = {}) {
  return new Promise(resolve => {
    window.speechSynthesis.cancel();

    const normalized = normalizeTTSText(text);

    // Split into sentences for more natural pacing — the engine handles shorter chunks better
    const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
    const voice = pickVoice();

    let idx = 0;
    function speakNext() {
      if (idx >= sentences.length) { resolve(); return; }
      // Strip trailing periods/ellipsis so TTS doesn't say "full stop" or "dot"
      const chunk = sentences[idx].trim().replace(/[.]+$/, '').trim();
      if (!chunk) { idx++; speakNext(); return; }

      const u = new SpeechSynthesisUtterance(chunk);

      // Conversational rate & pitch
      u.rate = 0.93;
      u.pitch = 1.02;
      u.volume = 1.0;

      if (emotion === 'excited') { u.rate = 1.02; u.pitch = 1.1; }
      else if (emotion === 'encouraging') { u.rate = 0.90; u.pitch = 1.06; }
      else if (emotion === 'sympathetic') { u.rate = 0.86; u.pitch = 0.96; }

      if (voice) u.voice = voice;

      u.onend = () => {
        idx++;
        // Brief pause between sentences for natural breathing rhythm
        setTimeout(speakNext, 180);
      };
      u.onerror = () => { idx++; speakNext(); };
      window.speechSynthesis.speak(u);
    }
    speakNext();
  });
}

// ════════════════════════════════════════
// STT
// ════════════════════════════════════════

// Passive listener — runs in background during question speech to catch early answers
let _passiveRecog = null;
let _passiveResolve = null;

function listenPassive() {
  return new Promise(resolve => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { resolve({ match: null }); return; }

    _passiveResolve = resolve;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.lang = 'en-US';
    _passiveRecog = r;

    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      _passiveRecog = null;
      _passiveResolve = null;
      try { r.stop(); } catch {}
      resolve(result);
    }

    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        const m = matchLetter(t);
        if (m) { finish({ transcript: t, match: m, timedOut: false }); return; }
      }
    };
    r.onerror = () => {};  // silently ignore — the normal listen() will take over
    r.onend = () => {
      // Restart if not done — browser may stop recognition after silence
      if (!done && _passiveRecog === r) {
        try { r.start(); } catch {}
      }
    };

    try { r.start(); } catch { resolve({ match: null }); }
  });
}

function stopPassiveListener() {
  if (_passiveRecog) {
    const r = _passiveRecog;
    const res = _passiveResolve;
    _passiveRecog = null;
    _passiveResolve = null;
    try { r.onend = null; r.stop(); } catch {}
    if (res) res({ match: null });
  }
}

function listen() {
  return new Promise(resolve => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.maxAlternatives = 3; r.lang = 'en-US';
    S.recog = r; S.listening = true;
    showListening(true);

    let final = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; r.stop(); S.listening = false; showListening(false); resolve({ transcript: final, match: matchLetter(final), timedOut: true }); }
    }, 8000);

    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final = t;
          const m = matchLetter(t);
          if (m && !done) { clearTimeout(timer); done = true; r.stop(); S.listening = false; showListening(false); resolve({ transcript: t, match: m, timedOut: false }); }
        } else {
          updateHeard(t);
          const m = matchLetter(t);
          if (m && !done) { clearTimeout(timer); done = true; r.stop(); S.listening = false; showListening(false); resolve({ transcript: t, match: m, timedOut: false }); }
        }
      }
    };
    r.onerror = e => { if (!done) { clearTimeout(timer); done = true; S.listening = false; showListening(false); resolve({ transcript: '', match: null, timedOut: false, error: e.error }); } };
    r.onend = () => { if (!done) { clearTimeout(timer); done = true; S.listening = false; showListening(false); resolve({ transcript: final, match: matchLetter(final), timedOut: false }); } };
    r.start();
  });
}

function matchLetter(t) {
  if (!t) return null;
  t = t.toLowerCase().trim();
  for (const l of LABELS) { if (t === l.toLowerCase() || t.startsWith(l.toLowerCase() + ' ') || t.startsWith(l.toLowerCase() + '.') || t.startsWith(l.toLowerCase() + ',')) return l; }
  const phon = { 'ay': 'A', 'hey': 'A', 'eh': 'A', 'aye': 'A', 'bee': 'B', 'be': 'B', 'beef': 'B', 'see': 'C', 'sea': 'C', 'si': 'C', 'dee': 'D', 'de': 'D', 'the': 'D' };
  for (const [p, l] of Object.entries(phon)) { if (t === p || t.startsWith(p + ' ')) return l; }
  const q = S.questions[S.idx];
  if (q) {
    for (let i = 0; i < q.opts.length; i++) {
      const optText = q.opts[i].toLowerCase();
      if (t.includes(optText) || optText.includes(t)) return LABELS[i];
      const words = optText.split(/\s+/).filter(w => w.length > 4);
      for (const w of words) { if (t.includes(w)) return LABELS[i]; }
    }
  }
  return null;
}

// ════════════════════════════════════════
// VOICE UI
// ════════════════════════════════════════
function showListening(on) {
  const ind = document.getElementById('voiceInd');
  const lbl = document.getElementById('voiceLabel');
  if (on) {
    ind.innerHTML = Array.from({ length: 5 }, (_, i) => `<div class="w-1 bg-glow rounded-full wave-bar" style="animation-delay:${i * 0.12}s;height:${10 + Math.random() * 14}px"></div>`).join('');
    lbl.textContent = 'Listening — say A, B, C, or D';
    lbl.className = 'text-sm font-mono text-glow h-5';
  } else {
    ind.innerHTML = '';
    lbl.textContent = '';
    lbl.className = 'text-sm font-mono text-muted h-5';
  }
}
function showSpeaking() {
  document.getElementById('voiceInd').innerHTML = '<div class="w-3 h-3 rounded-full bg-glow/50 pulse-ring"></div>';
  const lbl = document.getElementById('voiceLabel');
  lbl.textContent = 'Speaking...';
  lbl.className = 'text-sm font-mono text-muted/60 h-5';
}
function updateHeard(t) {
  if (t) document.getElementById('voiceLabel').textContent = `"${t}"`;
}

// ════════════════════════════════════════
// SCREENS
// ════════════════════════════════════════
function show(id) {
  ['screenStart', 'screenQuiz', 'screenSummary', 'screenAskMe'].forEach(s => {
    const el = document.getElementById(s);
    el.classList.add('hidden'); el.classList.remove('flex');
  });
  const el = document.getElementById(id);
  el.classList.remove('hidden'); el.classList.add('flex', 'fade-in');
}

function showLoading(on) {
  const btn = document.getElementById('btnStart');
  const loader = document.getElementById('loadingState');
  if (on) {
    btn.classList.add('hidden');
    loader.classList.remove('hidden');
  } else {
    btn.classList.remove('hidden');
    loader.classList.add('hidden');
  }
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

// ════════════════════════════════════════
// GAME FLOW
// ════════════════════════════════════════
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function startGame() {
  if (!ClaudeAPI.getConfig().apiKey) {
    showError('API key not found. Make sure config.json exists with your ANTHROPIC_API_KEY.');
    return;
  }

  if (S.mode === 'askme') {
    await startAskMe();
  } else if (S.mode === 'study') {
    await startStudyGame();
  } else {
    await startTopicGame();
  }
}

async function startTopicGame() {
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) {
    showError('Please enter a topic.');
    return;
  }

  S.topic = topic;
  showLoading(true);
  document.getElementById('loadingLabel').textContent = 'Generating questions with Claude...';

  try {
    const allQuestions = await ClaudeAPI.generateQuestions(topic);
    S.questions = shuffle(allQuestions).slice(0, Math.min(S.length, allQuestions.length));
    S.idx = 0; S.correct = 0; S.streak = 0; S.bestStreak = 0; S.attempts = [];
    S.skipped = false; S.quitting = false;

    document.getElementById('headerInfo').textContent = topic.toUpperCase().slice(0, 30);
    showLoading(false);
    show('screenQuiz');
    showSpeaking();
    await speak(`Let's go! ${S.questions.length} questions about ${topic}. Say A, B, C, or D after each one.`, { emotion: 'excited' });
    await runQ();
  } catch (err) {
    showLoading(false);
    showError(err.message || 'Failed to generate questions. Check your API key and try again.');
  }
}

async function startStudyGame() {
  if (!S.pdfText) {
    showError('Please upload a PDF first.');
    return;
  }

  const focus = document.getElementById('focusInput').value.trim();
  S.topic = S.pdfName + (focus ? ` — ${focus}` : '');
  showLoading(true);
  document.getElementById('loadingLabel').textContent = 'Reading your material and generating questions...';

  try {
    const allQuestions = await ClaudeAPI.generateQuestionsFromPDF(S.pdfText, focus);
    S.questions = shuffle(allQuestions).slice(0, Math.min(S.length, allQuestions.length));
    S.idx = 0; S.correct = 0; S.streak = 0; S.bestStreak = 0; S.attempts = [];
    S.skipped = false; S.quitting = false;

    document.getElementById('headerInfo').textContent = S.pdfName.slice(0, 30).toUpperCase();
    showLoading(false);
    show('screenQuiz');
    showSpeaking();
    const intro = focus
      ? `Let's go! ${S.questions.length} questions from your study material, focusing on ${focus}.`
      : `Let's go! ${S.questions.length} questions from your study material.`;
    await speak(intro + ' Say A, B, C, or D after each one.', { emotion: 'excited' });
    await runQ();
  } catch (err) {
    showLoading(false);
    showError(err.message || 'Failed to generate questions. Check your API key and try again.');
  }
}

async function runQ() {
  const q = S.questions[S.idx];
  const total = S.questions.length;

  document.getElementById('qCount').textContent = `Q${S.idx + 1} / ${total}`;
  document.getElementById('qScore').textContent = `${S.correct} / ${S.idx}`;
  document.getElementById('qBar').style.width = `${(S.idx / total) * 100}%`;
  document.getElementById('qCat').textContent = S.topic;

  const streakEl = document.getElementById('qStreak');
  if (S.streak >= 3) {
    streakEl.classList.remove('hidden');
    streakEl.innerHTML = `<span class="streak-fire">🔥</span> ${S.streak}`;
  } else {
    streakEl.classList.add('hidden');
  }

  document.getElementById('qStem').textContent = q.q;
  document.getElementById('qOpts').innerHTML = q.opts.map((o, i) => `
    <div class="opt-row flex items-center gap-3 py-2 px-3 rounded-lg" id="opt${LABELS[i]}">
      <span class="opt-badge bg-glow/10 text-glow">${LABELS[i]}</span>
      <span class="text-soft/80 text-sm">${o}</span>
    </div>
  `).join('');

  // Speak the question while listening — user can interrupt and answer mid-question
  showSpeaking();
  const optsText = q.opts.map((o, i) => `${LABELS[i]}: ${o}`).join('. ');
  const questionText = `Question ${S.idx + 1}. ${q.q} .. ${optsText}`;

  // Start speaking and listening at the same time
  let earlyAnswer = null;
  const speakDone = speak(questionText);
  const earlyListen = listenPassive();  // lightweight listener that runs during speech

  // Race: either speech finishes or user answers early
  earlyAnswer = await Promise.race([
    speakDone.then(() => null),   // speech finished, no early answer
    earlyListen,                   // user spoke an answer
  ]);

  if (earlyAnswer?.match) {
    // User answered mid-question — cancel speech and stop passive listener
    window.speechSynthesis.cancel();
    stopPassiveListener();
  } else {
    // Speech finished normally — stop the passive listener
    stopPassiveListener();
  }

  if (S.quitting) { await finish(); return; }
  if (S.skipped) { S.skipped = false; await handleSkip(q); return; }

  // If we got an early answer, use it; otherwise do the normal listen-with-retry flow
  let result = earlyAnswer?.match ? earlyAnswer : null;

  if (!result?.match) {
    let retries = 0;
    while (retries <= 2) {
      result = await listen();
      if (S.quitting) { await finish(); return; }
      if (S.skipped) { S.skipped = false; await handleSkip(q); return; }
      if (result.match) break;
      retries++;
      if (retries <= 2) {
        showSpeaking();
        if (result.timedOut) await speak("I didn't hear anything. Say A, B, C, or D.");
        else if (result.transcript) await speak(`I heard "${result.transcript}". Try just saying the letter.`);
        else await speak("Didn't catch that. Say A, B, C, or D.");
        if (S.quitting) { await finish(); return; }
        if (S.skipped) { S.skipped = false; await handleSkip(q); return; }
      }
    }
  }

  const picked = result?.match || null;
  const isRight = picked === q.a;

  // Visual feedback
  if (picked) {
    const pickedRow = document.getElementById('opt' + picked);
    if (pickedRow) {
      pickedRow.classList.add(isRight ? 'bg-correct/10' : 'bg-wrong/10');
      pickedRow.querySelector('.opt-badge').className = `opt-badge ${isRight ? 'bg-correct/20 text-correct' : 'bg-wrong/20 text-wrong'}`;
    }
  }
  if (!isRight) {
    const correctRow = document.getElementById('opt' + q.a);
    if (correctRow) {
      correctRow.classList.add('bg-correct/10');
      correctRow.querySelector('.opt-badge').className = 'opt-badge bg-correct/20 text-correct';
    }
  }

  if (isRight) { S.correct++; S.streak++; if (S.streak > S.bestStreak) S.bestStreak = S.streak; }
  else { S.streak = 0; }
  S.attempts.push({ q: q.q, picked, answer: q.a, correct: isRight });

  document.getElementById('qScore').textContent = `${S.correct} / ${S.idx + 1}`;

  showSpeaking();
  if (!picked) {
    await speak(`The answer was ${q.a}, ${q.opts[LABELS.indexOf(q.a)]}. ${q.why}`, { emotion: 'encouraging' });
  } else if (isRight) {
    const yay = ['Correct!', 'Right!', 'Nice!', 'Got it!', 'Yes!', 'Nailed it!', 'Boom!'][Math.floor(Math.random() * 7)];
    await speak(yay, { emotion: 'excited' });
  } else {
    await speak(`Nope, it's ${q.a}, ${q.opts[LABELS.indexOf(q.a)]}. ${q.why}`, { emotion: 'sympathetic' });
  }

  if (S.quitting) { await finish(); return; }

  S.idx++;
  if (S.idx < S.questions.length) {
    await new Promise(r => setTimeout(r, 400));
    await runQ();
  } else {
    await finish();
  }
}

async function handleSkip(q) {
  // Highlight correct answer
  const correctRow = document.getElementById('opt' + q.a);
  if (correctRow) {
    correctRow.classList.add('bg-correct/10');
    correctRow.querySelector('.opt-badge').className = 'opt-badge bg-correct/20 text-correct';
  }

  S.streak = 0;
  S.attempts.push({ q: q.q, picked: 'SKIP', answer: q.a, correct: false });
  document.getElementById('qScore').textContent = `${S.correct} / ${S.idx + 1}`;

  showSpeaking();
  await speak(`Skipped. The answer was ${q.a}, ${q.opts[LABELS.indexOf(q.a)]}. ${q.why}`, { emotion: 'encouraging' });

  if (S.quitting) { await finish(); return; }

  S.idx++;
  if (S.idx < S.questions.length) {
    await new Promise(r => setTimeout(r, 400));
    await runQ();
  } else {
    await finish();
  }
}

async function finish() {
  document.getElementById('qBar').style.width = '100%';
  await new Promise(r => setTimeout(r, 400));
  show('screenSummary');

  const pct = Math.round((S.correct / S.questions.length) * 100);
  let emoji = '🎉', sub = '';
  if (pct === 100) { emoji = '👑'; sub = 'PERFECT SCORE'; }
  else if (pct >= 80) { emoji = '🔥'; sub = 'EXCELLENT'; }
  else if (pct >= 60) { emoji = '💪'; sub = 'SOLID EFFORT'; }
  else if (pct >= 40) { emoji = '📚'; sub = 'KEEP STUDYING'; }
  else { emoji = '😅'; sub = 'TOUGH ROUND'; }

  document.getElementById('summaryEmoji').textContent = emoji;
  document.getElementById('summaryPct').textContent = `${S.correct} / ${S.questions.length}`;
  document.getElementById('summarySubline').textContent = sub + (S.bestStreak >= 3 ? `  ·  🔥 Best streak: ${S.bestStreak}` : '');

  document.getElementById('summaryList').innerHTML = S.attempts.map(a => `
    <div class="flex items-center gap-3 text-sm py-2 px-3 rounded-lg ${a.correct ? 'bg-correct/5' : 'bg-wrong/5'}">
      <span class="font-mono w-5 text-xs ${a.correct ? 'text-correct' : 'text-wrong'}">${a.correct ? '✓' : '✗'}</span>
      <span class="text-soft/60 flex-1 text-left truncate">${a.q.length > 55 ? a.q.slice(0, 55) + '…' : a.q}</span>
      <span class="font-mono text-xs ${a.correct ? 'text-correct/50' : 'text-wrong/50'}">${a.picked || '—'} → ${a.answer}</span>
    </div>
  `).join('');

  showSpeaking();
  let msg = `You got ${S.correct} out of ${S.questions.length}.`;
  if (pct === 100) msg += ' Perfect score, incredible!';
  else if (pct >= 80) msg += ' Excellent work!';
  else if (pct >= 60) msg += ' Solid effort, keep going!';
  else msg += ' No worries, try again!';
  if (S.bestStreak >= 3) msg += ` Your best streak was ${S.bestStreak} in a row.`;
  const mood = pct >= 60 ? 'excited' : 'encouraging';
  await speak(msg, { emotion: mood });
}

function stopVoice() {
  window.speechSynthesis.cancel();
  if (S.recog) try { S.recog.stop(); } catch { }
  S.listening = false;
}

function skipQuestion() {
  S.skipped = true;
  stopVoice();
}

function quitQuiz() {
  S.quitting = true;
  stopVoice();
}

function resetToStart() {
  stopVoice();
  S.quitting = false;
  S.skipped = false;
  document.getElementById('headerInfo').textContent = '';
  show('screenStart');
}

function playAgain() {
  stopVoice();
  S.quitting = false;
  S.skipped = false;
  startGame();
}

// ════════════════════════════════════════
// ASK ME — PDF handling
// ════════════════════════════════════════
let askmeDropZoneInit = false;

function initAskmeDropZone() {
  if (askmeDropZoneInit) return;
  askmeDropZoneInit = true;

  const zone = document.getElementById('askmeDropZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => { zone.classList.remove('dragover'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      processAskmePDF(file);
    } else {
      showError('Please upload a PDF file.');
    }
  });
}

function handleAskmePDFSelect(event) {
  const file = event.target.files[0];
  if (file) processAskmePDF(file);
}

async function processAskmePDF(file) {
  const dropZone = document.getElementById('askmeDropZone');
  const dropLabel = document.getElementById('askmeDropLabel');
  const fileInfo = document.getElementById('askmePdfInfo');

  dropLabel.textContent = 'Reading PDF...';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n\n';
    }

    text = text.trim();
    if (!text || text.length < 50) {
      showError('Could not extract enough text from this PDF. It may be image-based.');
      dropLabel.innerHTML = 'Drop a PDF here or <span class="text-glow">click to browse</span>';
      return;
    }

    S.askmeContext = text;
    S.askmePdfName = file.name;

    dropZone.classList.add('hidden');
    fileInfo.classList.remove('hidden');
    document.getElementById('askmePdfName').textContent = file.name;
    document.getElementById('askmePdfPages').textContent = `${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}`;
  } catch (err) {
    showError('Failed to read PDF: ' + (err.message || 'Unknown error'));
    dropLabel.innerHTML = 'Drop a PDF here or <span class="text-glow">click to browse</span>';
  }
}

function clearAskmePDF() {
  S.askmeContext = '';
  S.askmePdfName = '';
  document.getElementById('askmeDropZone').classList.remove('hidden');
  document.getElementById('askmePdfInfo').classList.add('hidden');
  document.getElementById('askmePdfInput').value = '';
  document.getElementById('askmeDropLabel').innerHTML = 'Drop a PDF here or <span class="text-glow">click to browse</span>';
}

// ════════════════════════════════════════
// ASK ME — Chat flow
// ════════════════════════════════════════
async function startAskMe() {
  S.askmeMessages = [];

  show('screenAskMe');

  // Show PDF badge if context loaded
  const badge = document.getElementById('askmeRefBadge');
  if (S.askmeContext) {
    badge.classList.remove('hidden');
    badge.textContent = S.askmePdfName.length > 20 ? S.askmePdfName.slice(0, 20) + '…' : S.askmePdfName;
  } else {
    badge.classList.add('hidden');
  }

  // Reset chat to just the welcome message
  const chat = document.getElementById('askmeChat');
  const welcome = S.askmeContext
    ? `Hi! I've loaded your notes from ${S.askmePdfName}. Ask me anything about the material — formulas, concepts, anything. I'll explain and read it out to you.`
    : `Hi! Ask me anything — formulas, concepts, definitions. Upload a PDF next time if you want me to reference your notes.`;
  chat.innerHTML = `
    <div class="flex justify-start fade-in">
      <div class="bg-panel/60 border border-white/[0.04] rounded-2xl rounded-tl-md px-4 py-3 max-w-[85%]">
        <p class="text-sm text-soft/80 leading-relaxed">${welcome}</p>
      </div>
    </div>`;

  document.getElementById('askmeInput').focus();

  // Speak welcome
  showAskmeSpeaking();
  await speak(welcome, { emotion: 'encouraging' });
  clearAskmeVoice();
}

function renderAskmeMessage(role, text) {
  const chat = document.getElementById('askmeChat');
  const isUser = role === 'user';

  const bubble = document.createElement('div');
  bubble.className = `flex ${isUser ? 'justify-end' : 'justify-start'} fade-in`;
  bubble.innerHTML = `
    <div class="${isUser ? 'bg-glow/10 border border-glow/10 rounded-2xl rounded-tr-md' : 'bg-panel/60 border border-white/[0.04] rounded-2xl rounded-tl-md'} px-4 py-3 max-w-[85%]">
      <p class="text-sm ${isUser ? 'text-soft' : 'text-soft/80'} leading-relaxed">${escapeHTML(text)}</p>
    </div>`;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

function showAskmeTyping(on) {
  const chat = document.getElementById('askmeChat');
  const existing = document.getElementById('askmeTypingBubble');
  if (on && !existing) {
    const el = document.createElement('div');
    el.id = 'askmeTypingBubble';
    el.className = 'flex justify-start fade-in';
    el.innerHTML = `
      <div class="bg-panel/60 border border-white/[0.04] rounded-2xl rounded-tl-md px-4 py-3">
        <div class="loader-dots flex gap-1.5">
          <span class="w-2 h-2 bg-glow/60 rounded-full"></span>
          <span class="w-2 h-2 bg-glow/60 rounded-full"></span>
          <span class="w-2 h-2 bg-glow/60 rounded-full"></span>
        </div>
      </div>`;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
  } else if (!on && existing) {
    existing.remove();
  }
}

function showAskmeSpeaking() {
  document.getElementById('askmeVoiceInd').innerHTML = '<div class="w-3 h-3 rounded-full bg-glow/50 pulse-ring"></div>';
  document.getElementById('askmeVoiceLabel').textContent = 'Speaking...';
}

function showAskmeListening() {
  const ind = document.getElementById('askmeVoiceInd');
  ind.innerHTML = Array.from({ length: 5 }, (_, i) =>
    `<div class="w-1 bg-glow rounded-full wave-bar" style="animation-delay:${i * 0.12}s;height:${10 + Math.random() * 14}px"></div>`
  ).join('');
  document.getElementById('askmeVoiceLabel').textContent = 'Listening...';
}

function clearAskmeVoice() {
  document.getElementById('askmeVoiceInd').innerHTML = '';
  document.getElementById('askmeVoiceLabel').textContent = '';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function sendAskMe() {
  const input = document.getElementById('askmeInput');
  const text = input.value.trim();
  if (!text || S.askmeBusy) return;

  S.askmeBusy = true;
  input.value = '';

  // Stop any ongoing speech
  window.speechSynthesis.cancel();

  // Show user message
  renderAskmeMessage('user', text);
  S.askmeMessages.push({ role: 'user', content: text });

  // Show typing indicator
  showAskmeTyping(true);

  try {
    const response = await ClaudeAPI.askQuestion(S.askmeMessages, S.askmeContext);
    showAskmeTyping(false);

    // Show and speak response
    S.askmeMessages.push({ role: 'assistant', content: response });
    renderAskmeMessage('assistant', response);

    showAskmeSpeaking();
    await speak(response);
    clearAskmeVoice();
  } catch (err) {
    showAskmeTyping(false);
    const errMsg = 'Sorry, something went wrong. ' + (err.message || '');
    renderAskmeMessage('assistant', errMsg);
    clearAskmeVoice();
  }

  S.askmeBusy = false;
  input.focus();
}

async function voiceAskMe() {
  if (S.askmeBusy) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  // Stop any ongoing speech
  window.speechSynthesis.cancel();

  const input = document.getElementById('askmeInput');
  const btn = document.getElementById('btnAskMeVoice');
  const r = new SR();
  r.continuous = false;
  r.interimResults = true;
  r.lang = 'en-US';

  btn.classList.add('border-glow/40', 'text-glow');
  btn.disabled = true;
  showAskmeListening();

  r.onresult = e => {
    let transcript = '';
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    input.value = transcript;
  };

  r.onend = () => {
    btn.classList.remove('border-glow/40', 'text-glow');
    btn.disabled = false;
    clearAskmeVoice();
    // Auto-send if we got something
    if (input.value.trim()) sendAskMe();
  };

  r.onerror = () => {
    btn.classList.remove('border-glow/40', 'text-glow');
    btn.disabled = false;
    clearAskmeVoice();
  };

  r.start();
}

function exitAskMe() {
  stopVoice();
  S.askmeBusy = false;
  S.askmeMessages = [];
  document.getElementById('headerInfo').textContent = '';
  show('screenStart');
}
