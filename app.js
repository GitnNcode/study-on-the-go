// ════════════════════════════════════════
// DriveTrivia — Quiz Logic
// ════════════════════════════════════════

const LABELS = ['A', 'B', 'C', 'D'];

let S = {
  mode: 'topic',       // 'topic' or 'study'
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
};

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  setModel('claude-haiku-4-5-20251001');
  setLength(10);
  checkBrowser();
  loadApiKey();
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
// API KEY MANAGEMENT
// ════════════════════════════════════════
function loadApiKey() {
  const saved = localStorage.getItem('claude_api_key') || '';
  const input = document.getElementById('apiKeyInput');
  if (saved) {
    input.value = saved;
    ClaudeAPI.configure({ apiKey: saved });
  }
}

function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (key) {
    localStorage.setItem('claude_api_key', key);
    ClaudeAPI.configure({ apiKey: key });
  }
}

function toggleKeyVisibility() {
  const input = document.getElementById('apiKeyInput');
  const btn = document.getElementById('toggleKeyBtn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
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
  const topicTab = document.getElementById('tabTopic');
  const studyTab = document.getElementById('tabStudy');
  const topicFields = document.getElementById('topicFields');
  const studyFields = document.getElementById('studyFields');

  if (mode === 'topic') {
    topicTab.className = 'mode-tab flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border-glow/30 bg-glow/10 text-glow';
    studyTab.className = 'mode-tab flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-muted hover:text-soft';
    topicFields.classList.remove('hidden');
    studyFields.classList.add('hidden');
  } else {
    studyTab.className = 'mode-tab flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border-glow/30 bg-glow/10 text-glow';
    topicTab.className = 'mode-tab flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-muted hover:text-soft';
    studyFields.classList.remove('hidden');
    topicFields.classList.add('hidden');
    initDropZone();
  }
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

function speak(text, { emotion = 'neutral' } = {}) {
  return new Promise(resolve => {
    window.speechSynthesis.cancel();

    // Insert natural pauses at punctuation for more human phrasing
    const paced = text
      .replace(/\.\s+/g, '. ... ')
      .replace(/!\s+/g, '! .. ')
      .replace(/\?\s+/g, '? .. ');

    const u = new SpeechSynthesisUtterance(paced);

    // Slightly slower than default for a more relaxed, conversational feel
    u.rate = 0.95;
    u.pitch = 1.0;

    // Shift pitch/rate slightly based on emotional context
    if (emotion === 'excited') { u.rate = 1.05; u.pitch = 1.12; }
    else if (emotion === 'encouraging') { u.rate = 0.92; u.pitch = 1.05; }
    else if (emotion === 'sympathetic') { u.rate = 0.88; u.pitch = 0.95; }

    const voice = pickVoice();
    if (voice) u.voice = voice;

    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

// ════════════════════════════════════════
// STT
// ════════════════════════════════════════
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
  ['screenStart', 'screenQuiz', 'screenSummary'].forEach(s => {
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
  saveApiKey();
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) {
    showError('Please enter your Anthropic API key.');
    return;
  }

  if (S.mode === 'study') {
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

  // Speak the question
  showSpeaking();
  const optsText = q.opts.map((o, i) => `${LABELS[i]}: ${o}`).join('. ');
  await speak(`Question ${S.idx + 1}. ${q.q} .. ${optsText}`);

  if (S.quitting) { await finish(); return; }
  if (S.skipped) { S.skipped = false; await handleSkip(q); return; }

  // Listen with retry
  let result = null;
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
