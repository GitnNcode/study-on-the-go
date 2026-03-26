// ════════════════════════════════════════
// Claude API — Configuration & Service
// ════════════════════════════════════════

const ClaudeAPI = (() => {
  // --- Config ---
  const config = {
    apiKey: '',
    baseURL: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5-20251001',
    apiVersion: '2023-06-01',
    maxTokens: 4096,
  };

  async function loadConfig() {
    try {
      const res = await fetch('config.json');
      if (!res.ok) throw new Error('config.json not found');
      const data = await res.json();
      if (data.ANTHROPIC_API_KEY) {
        config.apiKey = data.ANTHROPIC_API_KEY;
      }
      return data;
    } catch (e) {
      console.error('Failed to load config.json:', e.message);
      return null;
    }
  }

  function configure(overrides) {
    Object.assign(config, overrides);
  }

  function getConfig() {
    return { ...config };
  }

  // --- Request helper ---
  async function sendMessage(systemPrompt, userMessage) {
    if (!config.apiKey) {
      throw new Error('API key not set. Call ClaudeAPI.configure({ apiKey: "sk-..." }) first.');
    }

    const url = `${config.baseURL}/v1/messages`;

    const body = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': config.apiVersion,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error (${res.status}): ${err}`);
    }

    const data = await res.json();

    // Extract text from the response content blocks
    const text = data.content
      ?.filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') || '';

    if (!text) {
      throw new Error('Empty response from Claude API.');
    }

    return text;
  }

  // --- Quiz question generator ---
  const SYSTEM_PROMPT = `You are a quiz question generator. You MUST respond with ONLY a valid JSON array — no markdown fences, no explanation, no extra text. The array must contain exactly 15 objects, each with these fields:
- "q": the question text (string)
- "opts": an array of exactly 4 answer options (strings), where the first option is always the correct answer
- "why": a one-sentence explanation of why the correct answer is right (string)

Rules:
- Questions should be varied in difficulty (mix of easy, medium, hard).
- Options should be plausible — avoid obvious throw-away choices.
- Keep questions concise and clear.
- The correct answer MUST always be the first element in "opts".
- Use proper math/science notation with Unicode symbols where appropriate (e.g. E = mc², H₂O, Δx, √x, ∫f(x)dx, θ, λ, π). This makes formulas display correctly on screen.`;

  async function generateQuestions(topic) {
    const userMsg = `Generate 15 multiple-choice trivia/study questions about: ${topic}`;
    const raw = await sendMessage(SYSTEM_PROMPT, userMsg);

    return parseQuestions(raw);
  }

  // --- PDF-based question generator ---
  const PDF_SYSTEM_PROMPT = `You are a study quiz generator. You receive text extracted from a student's study material (lecture notes, textbook chapters, etc). Your job is to create quiz questions that test understanding of the material.

You MUST respond with ONLY a valid JSON array — no markdown fences, no explanation, no extra text. The array must contain exactly 15 objects, each with these fields:
- "q": the question text (string)
- "opts": an array of exactly 4 answer options (strings), where the first option is always the correct answer
- "why": a one-sentence explanation of why the correct answer is right (string)

Rules:
- Focus on key concepts: definitions, formulas, important facts, relationships, and processes from the material.
- Include questions about formulas and their components where applicable.
- Test definitions of key terms from the material.
- Include some application questions that test understanding, not just recall.
- Questions should be varied in difficulty (mix of easy, medium, hard).
- Options should be plausible — use common misconceptions as distractors.
- The correct answer MUST always be the first element in "opts".
- All questions and answers must come directly from the provided material.
- Use proper math/science notation with Unicode symbols where appropriate (e.g. E = mc², H₂O, Δx, √x, ∫f(x)dx, θ, λ, π). This makes formulas display correctly on screen.`;

  async function generateQuestionsFromPDF(pdfText, focusArea) {
    // Truncate text if too long (stay well within context window)
    const maxChars = 80000;
    let materialText = pdfText;
    if (materialText.length > maxChars) {
      materialText = materialText.slice(0, maxChars) + '\n\n[... material truncated for length ...]';
    }

    let userMsg = `Here is the study material:\n\n---\n${materialText}\n---\n\n`;
    if (focusArea) {
      userMsg += `Focus specifically on: ${focusArea}\n\n`;
    }
    userMsg += 'Generate 15 multiple-choice questions based on this material.';

    const raw = await sendMessage(PDF_SYSTEM_PROMPT, userMsg);
    return parseQuestions(raw);
  }

  // --- Response parsing ---
  function parseQuestions(raw) {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Try to extract a JSON array from the response
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          throw new Error('Failed to parse questions from API response.');
        }
      } else {
        throw new Error('No valid JSON array found in API response.');
      }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('API returned an empty or non-array response.');
    }

    // Validate and normalize each question
    const questions = [];
    for (const item of parsed) {
      if (!item.q || !Array.isArray(item.opts) || item.opts.length < 4) continue;

      // The correct answer is always opts[0] from the prompt.
      // Shuffle options and track where the correct one ends up.
      const correctText = item.opts[0];
      const shuffled = shuffleArray([...item.opts.slice(0, 4)]);
      const correctIdx = shuffled.indexOf(correctText);
      const LABELS = ['A', 'B', 'C', 'D'];

      questions.push({
        cat: 'AI Generated',
        q: item.q,
        opts: shuffled,
        a: LABELS[correctIdx],
        why: item.why || 'No explanation provided.',
      });
    }

    if (questions.length === 0) {
      throw new Error('No valid questions could be parsed from the API response.');
    }

    return questions;
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- Multi-turn conversation helper ---
  async function sendConversation(systemPrompt, messages) {
    if (!config.apiKey) {
      throw new Error('API key not set.');
    }

    const url = `${config.baseURL}/v1/messages`;

    const body = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': config.apiVersion,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const text = data.content
      ?.filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') || '';

    if (!text) {
      throw new Error('Empty response from Claude API.');
    }

    return text;
  }

  // --- Ask Me (conversational Q&A) ---
  const ASKME_SYSTEM_PROMPT = `You are a friendly, knowledgeable study tutor. The student will ask you questions about formulas, concepts, definitions, or anything academic. Answer clearly and concisely — aim for 2-4 sentences since your response will be read aloud.

If reference material from the student's notes is provided below, ground your answers in that material and cite specific parts when relevant. If the student asks about something not in the material, you may still answer from general knowledge but mention that it wasn't in their notes.

Use proper math/science notation with Unicode symbols where appropriate (e.g. E = mc², H₂O, Δx, √x, ∫f(x)dx, θ, λ, π). The text will be displayed on screen, so formulas should look correct visually. A separate system handles converting them to spoken words for TTS.
Never use markdown formatting, bullet points, or numbered lists — write in plain conversational sentences.`;

  async function askQuestion(messages, pdfContext) {
    let systemPrompt = ASKME_SYSTEM_PROMPT;
    if (pdfContext) {
      const maxChars = 60000;
      let material = pdfContext;
      if (material.length > maxChars) {
        material = material.slice(0, maxChars) + '\n\n[... material truncated ...]';
      }
      systemPrompt += `\n\nHere is the student's reference material:\n---\n${material}\n---`;
    }

    // Keep conversation manageable — trim old messages if too long
    let trimmedMessages = messages;
    if (messages.length > 30) {
      trimmedMessages = messages.slice(messages.length - 20);
    }

    return await sendConversation(systemPrompt, trimmedMessages);
  }

  // --- Public API ---
  return {
    loadConfig,
    configure,
    getConfig,
    sendMessage,
    sendConversation,
    generateQuestions,
    generateQuestionsFromPDF,
    askQuestion,
  };
})();
