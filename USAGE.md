# Quick Usage Guide

## Start the App

```bash
npm run electron:dev
```

## What Opens

1. **Main Window** (1200x800) - Full app interface
   - Fill context (resume, skills, projects, job description)
   - Start/Stop audio capture
   - View history

2. **Stealth Overlay** (420x700) - Hidden by default
   - Shows AI answers during interview
   - Invisible to screen share
   - Toggle with `Cmd+Shift+A`

## Workflow

### Before Interview
1. Fill context in main window
2. Click "Start Capture" → Select meeting tab + "Share tab audio"
3. Minimize main window

### During Interview
1. Share entire screen
2. Interviewer asks question → Wait 10 seconds
3. Press `Cmd+Shift+A` → Read answer → Press `Cmd+Shift+A` to hide

### After Interview
1. Press `Cmd+Shift+M` → Show main window
2. Stop capture, review history

## Shortcuts

- `Cmd+Shift+A`: Toggle stealth overlay
- `Cmd+Shift+R`: Reload stealth overlay
- `Cmd+Shift+M`: Show main window
