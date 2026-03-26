# DriveStudy (working title)

Voice-only study sessions for students to **learn while they drive**, safely.
DriveStudy turns commute time into short, quiz-style "episodes" where students answer questions by voice, completely hands-free.

## Features

- Voice-only quiz sessions optimized for driving (no tapping or reading while the car is moving).
- Multiple-choice, true/false, and short-answer questions via speech.
- Uses **gpt-4o-mini-transcribe** for fast, low-latency speech-to-text.
- Quiz logic powered by a small LLM (GPT-5-nano or Claude Haiku) for: question selection, feedback, and light explanations.
- Pluggable **on-device / free TTS** layer so the app can speak questions and feedback using local models.
- Basic progress tracking and spaced repetition so missed questions show up again later.

## Architecture

High-level pipeline:

1. App plays a question to the driver using on-device TTS.
2. Driver answers by voice; audio is sent to **gpt-4o-mini-transcribe** (streaming STT).
3. Transcription + quiz state are passed to a small LLM (GPT-5-nano / Claude Haiku).
4. LLM decides whether the answer is correct, generates short feedback, and picks the next question.
5. Text response is turned into audio via on-device TTS and played back.
6. Backend stores session results, accuracy, and next-review times for each question.

## Tech Stack (planned)

- **Mobile client**: _fill in (e.g., React Native / Swift / Kotlin / Flutter)_.
- **Backend**: _fill in (e.g., Node.js + PostgreSQL / Supabase / Firebase)_.
- **LLM**: GPT-5-nano or Claude Haiku for quiz logic and explanations.
- **STT**: OpenAI **gpt-4o-mini-transcribe** (streaming speech-to-text).
- **TTS**: On-device / free models (e.g. XTTS-v2, Coqui TTS, MeloTTS, or system TTS APIs), chosen for latency + offline-friendliness.

Update this section as you lock in specific libraries and SDKs.

## Getting Started

### Prerequisites

- Node.js / pnpm / yarn (if using JS/TS backend and/or React Native).
- Mobile dev environment set up (Xcode for iOS, Android Studio / SDK for Android).
- API keys for:
  - OpenAI (for gpt-4o-mini-transcribe and your chosen GPT-5-nano equivalent).
  - Anthropic (if you also use Claude Haiku).

### Installation

```bash
# Clone the repo
git clone https://github.com/<your-username>/drivestudy.git
cd drivestudy

# Install dependencies (example for monorepo)
cd backend && npm install
cd ../mobile && npm install
```

Add a `.env` (or similar) file in the backend with:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
# Add any DB / auth config here
```

## Usage

1. Start the backend:

```bash
cd backend
npm run dev
```

2. Run the mobile app (example for React Native):

```bash
cd mobile
npm run ios    # or: npm run android
```

3. In the app, sign up or log in.
4. Choose a course / deck and tap **Start drive session** while parked.
5. Follow the spoken instructions and answer questions by voice only.

## Project Structure

```text
.
├── backend/           # API + quiz logic + persistence
│   ├── src/
│   └── package.json
├── mobile/            # iOS/Android client
│   ├── src/
│   └── package.json
├── docs/              # Diagrams, notes, screenshots
└── README.md
```

## Roadmap

- [ ] Basic MVP: single-user sessions, fixed question sets.
- [ ] Teacher / student roles with shared decks.
- [ ] Spaced repetition and difficulty adaptation.
- [ ] CarPlay / Android Auto integration.
- [ ] Downloadable offline decks and on-device TTS only mode.
- [ ] Leaderboards + "study streaks" (only visible when parked).

## Contributing

Contributions, ideas, and bug reports are welcome!

- Open an issue for feature requests or bugs.
- Fork the repo and create a PR for code changes.
- Keep PRs small and focused (1 feature or fix per PR).

## License

MIT © 2026 <Your Name>
