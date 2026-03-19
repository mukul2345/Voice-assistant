# Interview Copilot - AI Interview Assistant

Real-time AI assistant for technical interviews. Provides instant answers during video calls.

## Features

- ✅ Real-time audio transcription
- ✅ AI-powered answer generation
- ✅ Interview type detection (Coding, System Design, Behavioral)
- ✅ Context-aware responses (resume, skills, projects, job description)
- ✅ Desktop app with stealth mode (invisible to screen share)
- ✅ Conversation history and export
- ✅ Free tier (Groq API) or OpenAI fallback

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup API Key
```bash
cp .env.example .env
# Edit .env and add your API key:
# GROQ_API_KEY=your_groq_api_key
# or
# AI_INTEGRATIONS_OPENAI_API_KEY=your_openai_api_key
```

Get free Groq API key: https://console.groq.com

### 3. Start Desktop App
```bash
npm run electron:dev
```

## How to Use

### Before Interview
1. Start the desktop app
2. **Main window opens** - Fill in your context:
   - Resume/background
   - Skills
   - Projects
   - Job description
3. Click "Start Capture"
4. Select your meeting tab and check "Share tab audio"
5. Minimize the main window

### During Interview
1. Share your entire screen with interviewer
2. When interviewer asks a question:
   - Wait 10 seconds of silence (AI processes the question)
   - Press `Cmd+Shift+A` (Mac) or `Ctrl+Shift+A` (Win)
   - Stealth overlay appears with answer (invisible to interviewer)
   - Read the answer
   - Press `Cmd+Shift+A` to hide
3. Repeat for each question

### After Interview
1. Press `Cmd+Shift+M` to show main window
2. Click "Stop Capture"
3. Review conversation history
4. Export if needed

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+A` (Mac) / `Ctrl+Shift+A` (Win) | Toggle stealth overlay |
| `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Win) | Reload stealth overlay |
| `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Win) | Show main window |

## Two Windows

### Main Window (1200x800)
- Full application interface
- Fill context, start/stop capture, view history
- **Visible to screen share** (minimize during interview)

### Stealth Overlay (420x700)
- Shows AI answers only
- **Invisible to screen share** when sharing entire screen
- Hidden by default, toggle with `Cmd+Shift+A`

## Screen Capture Protection

The stealth overlay is invisible to screen share:
- ✅ macOS: Uses `setContentProtection(true)`
- ✅ Windows: Tool window style
- ✅ Works with Zoom, Teams, Google Meet

**Important**: Share "Entire Screen" not "Window" for protection to work.

## Building Installers

```bash
# macOS
npm run electron:build:mac

# Windows
npm run electron:build:win

# Both
npm run electron:build:all
```

Output: `dist-electron/`

## Tech Stack

- **Frontend**: React + Vite + TypeScript
- **Backend**: Express + TypeScript
- **Desktop**: Electron
- **Audio**: MediaRecorder API
- **AI**: Groq API (free tier) or OpenAI
- **Styling**: Tailwind CSS + shadcn/ui

## How It Works

1. **Audio Capture**: Continuous recording with silence detection (10 seconds)
2. **Transcription**: Groq Whisper API (free) or OpenAI Whisper
3. **Context Analysis**: Combines question with your context (resume, skills, etc.)
4. **Answer Generation**: GPT-4 generates relevant answer
5. **Smart Memory**: Maintains conversation context (15 minutes / 4000 tokens)
6. **Display**: Shows answer in stealth overlay (invisible to screen share)

## Requirements

- Node.js 18+
- Chrome or Edge browser (for audio capture)
- macOS 10.15+ or Windows 10+ (for screen capture protection)
- Groq API key (free) or OpenAI API key

## Troubleshooting

### Main window not appearing?
- Check backend is running at http://localhost:5000
- Press `Cmd+Shift+M` to show main window

### Stealth overlay visible in screen share?
- Make sure you're sharing "Entire Screen" not "Window"
- macOS requires 10.15+ (Catalina or later)
- Windows requires Windows 10+

### Audio not capturing?
- Check "Share tab audio" when selecting tab
- Use Chrome or Edge (best compatibility)
- Grant microphone permissions

### No answers appearing?
- Check API key in .env file
- Wait 10 seconds of silence after question
- Check browser console (F12) for errors

## License

MIT
