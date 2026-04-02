# Study On The Go

**Work in progress** -- actively being developed and improved.

A voice-first quiz app that turns dead time (commutes, walks, chores) into hands-free study sessions. Pick a topic or upload a PDF, and the app generates multiple-choice questions using Claude AI, reads them aloud, and listens for your spoken answer. Eyes on the road, hands on the wheel.

## How It Works

1. **Choose a mode** -- Topic (type or speak any subject), Study (upload a PDF), or Ask Me (conversational Q&A with an AI tutor).
2. **AI generates questions** -- Claude Haiku creates multiple-choice questions from your topic or document.
3. **Listen and answer by voice** -- Questions and options are read aloud via TTS. Say "A", "B", "C", or "D" to answer. You can even answer while the question is still being read.
4. **Get instant feedback** -- The app tells you if you're right or wrong, tracks your streak, and shows a summary at the end.

No tapping, no reading, no looking at a screen required.

## Tech Stack

- **Frontend**: Vanilla HTML/JS + Tailwind CSS (single-page app, no build step)
- **AI**: Anthropic Claude API (Haiku by default, Sonnet and Opus also available)
- **Speech-to-Text**: Web Speech API (browser-native, no extra API calls)
- **Text-to-Speech**: Web Speech Synthesis API (browser-native)
- **PDF Parsing**: PDF.js for extracting text from uploaded documents

Everything runs client-side -- no backend server needed. Just an Anthropic API key in `config.json`.

## A Note on the Voice

The TTS uses your browser's built-in speech synthesis, which means **the voice is robotic**. It gets the job done and keeps things free and simple, but it's not going to win any audiobook narration awards. The app does a lot of text normalization (Greek letters, math symbols, chemical formulas, etc.) to make the robotic voice as clear as possible.

This is an easy swap -- plugging in a paid service like **ElevenLabs** would give it a much more natural, human-sounding voice. That's on the roadmap once the core experience is solid.

## Features

- **Three modes**: Topic quiz, PDF-based study, and conversational Ask Me
- **Fully hands-free**: Voice input for everything, including setup
- **Early answer detection**: Answer while the question is still being read
- **Smart TTS normalization**: Greek letters, superscripts, math operators, chemical formulas all spoken naturally
- **Progress tracking**: Score, streaks, accuracy percentage, detailed attempt history
- **Model selection**: Choose between Claude Haiku (fast/cheap), Sonnet (balanced), or Opus (most capable)
- **Configurable question count**: 5, 10, or 15 questions per session

## Getting Started

1. Clone the repo
2. Add your Anthropic API key to `config.json`:
   ```json
   {
     "ANTHROPIC_API_KEY": "sk-ant-..."
   }
   ```
3. Open `index.html` in a browser (or serve it locally)
4. Pick a mode, choose a topic, and start studying

## Project Structure

```
.
├── index.html      # Single-page app UI
├── app.js          # Core app logic -- quiz flow, TTS/STT, voice interactions
├── api.js          # Claude API wrapper -- question generation, Q&A, config
├── config.json     # API key storage
└── README.md
```

## Roadmap

- [x] Voice-controlled multiple-choice quizzes
- [x] PDF upload and question generation
- [x] Conversational Ask Me mode
- [x] Smart TTS text normalization for STEM content
- [ ] ElevenLabs or other premium TTS integration
- [ ] Spaced repetition for missed questions
- [ ] Session persistence (survive page refresh)
- [ ] CarPlay / Android Auto integration
- [ ] Offline mode with on-device models
- [ ] Teacher/student roles with shared decks

## License

MIT
