# Production-Ready Stealth Copilot Bugfix Design

## Overview

This design addresses 9 critical defects preventing the Interview Copilot from being production-ready and undetectable during video interviews. The fixes focus on: (1) Voice Activity Detection (VAD) to replace fixed polling, (2) OS-level content protection for true stealth mode, (3) pre-flight audio checks to prevent crashes, (4) session-long memory with rolling summaries, and (5) DevTools disabled in production. The approach ensures the overlay remains completely invisible in screen captures while maintaining all existing functionality.

## Glossary

- **Bug_Condition (C)**: The conditions that trigger each of the 9 bugs - fixed polling, visible screen capture, missing permission checks, limited memory, DevTools exposure
- **Property (P)**: The desired behavior - VAD-based processing, OS-level content protection, graceful error handling, full session memory, disabled DevTools
- **Preservation**: Existing functionality that must remain unchanged - manual stop, answer display, keyboard shortcuts, context file uploads, audio accumulation, screen sharing detection
- **Voice Activity Detection (VAD)**: Algorithm that detects speech presence and silence periods in audio streams to determine when a question is complete
- **Content Protection**: OS-level APIs (Windows SetContentProtection, macOS window level) that exclude windows from screen capture
- **Pre-flight Check**: Validation performed before audio capture to verify permissions and device availability
- **Rolling Summary**: Technique to compress old conversation history while retaining key information for session-long memory
- **MediaRecorder**: Browser API used to capture audio from screen sharing with system audio
- **Stealth Overlay**: The BrowserWindow that displays AI answers, must be invisible in screen captures but visible locally

## Bug Details

### Bug Condition

The bugs manifest across multiple scenarios in the Interview Copilot system:

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SystemState
  OUTPUT: boolean
  
  RETURN (
    // Bug 1-2: Fixed polling issues
    (input.audioProcessingMode == "FIXED_10_SEC_POLLING" 
     AND (input.questionDuration > 10 OR input.pauseDuration < 10))
    
    // Bug 3-4: Missing pre-flight checks
    OR (input.captureStarted == true 
        AND (input.micPermission == "NOT_GRANTED" OR input.audioDevice == null))
    
    // Bug 5-6: Screen capture visibility
    OR (input.stealthWindowVisible == true 
        AND input.screenSharingActive == true
        AND input.contentProtectionEnabled == false)
    
    // Bug 7: DevTools exposure
    OR (input.productionMode == true AND input.devToolsEnabled == true)
    
    // Bug 8-9: Memory limitations
    OR (input.conversationHistory.length > 5 
        AND input.memoryStrategy == "LAST_5_ONLY")
  )
END FUNCTION
```

### Examples

**Bug 1-2: Fixed Polling Issues**
- Interviewer asks: "Tell me about a time when you... [8 seconds]... had to deal with a difficult stakeholder" → System processes after 10 seconds, missing the complete question
- Interviewer pauses: "Can you explain... [2 second pause]... your approach to system design?" → System prematurely processes "Can you explain" as complete question

**Bug 3-4: Missing Pre-flight Checks**
- User clicks "Start Capture" without granting mic permissions → Uncaught DOMException: Permission denied
- User clicks "Start Capture" with headphones unplugged → TypeError: Cannot read property 'getAudioTracks' of undefined

**Bug 5-6: Screen Capture Visibility**
- Windows user shares screen via Zoom → Stealth overlay appears in interviewer's view as a floating window
- macOS user shares screen via Teams → Stealth overlay may appear depending on window level configuration

**Bug 7: DevTools Exposure**
- Developer accidentally leaves DevTools open → DevTools window visible during screen share, exposing the copilot tool

**Bug 8-9: Memory Limitations**
- Interviewer asks about "microservices architecture" at minute 5, then again at minute 40 → System provides different answer because first Q&A was evicted from memory
- Interviewer asks: "What's your experience with... [pause]... React and... [pause]... TypeScript?" → System treats as 3 separate questions instead of one

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Manual stop button must continue to immediately halt audio capture and clean up resources
- AI-generated answers must continue to display in the stealth overlay window
- Keyboard shortcut (Cmd+Shift+A / Ctrl+Shift+A) must continue to toggle overlay visibility
- Context file uploads (resume, job description) must continue to be included in AI prompts
- Audio chunk accumulation must continue when speech is detected above volume threshold
- System audio capture from meeting tab must continue to work with screen sharing permissions
- MediaRecorder audio data accumulation must continue in audioChunksRef buffer
- Track.onended event detection must continue to stop capture gracefully when screen sharing ends

**Scope:**
All inputs that do NOT involve the 9 specific bug conditions should be completely unaffected by this fix. This includes:
- Normal audio capture flow for questions under 10 seconds with clear silence
- Audio capture when permissions are already granted and devices are connected
- Overlay visibility when screen sharing is NOT active
- Development mode usage (DevTools remain available in dev mode)
- Short interviews where 5 Q&A memory is sufficient

## Hypothesized Root Cause

Based on the bug descriptions, the root causes are:

1. **Fixed Polling Architecture**: The system uses a hardcoded 10-second timer (`setInterval(processAudio, 10000)`) instead of detecting actual speech boundaries, causing premature or delayed processing

2. **Missing Content Protection APIs**: The Electron BrowserWindow for the stealth overlay does not call platform-specific APIs to exclude itself from screen capture (Windows: `win.setContentProtection(true)`, macOS: `win.setWindowLevel(NSScreenSaverWindowLevel)`)

3. **No Pre-flight Validation**: The `startCapture()` function immediately calls `navigator.mediaDevices.getDisplayMedia()` without first checking `navigator.permissions.query()` or verifying audio device availability

4. **Naive Memory Strategy**: The conversation history uses a simple array with `.slice(-5)` to keep only the last 5 Q&A pairs, discarding all earlier context without summarization

5. **DevTools Not Disabled**: The Electron main process does not call `win.webContents.closeDevTools()` or set `devTools: false` in production builds

6. **No VAD Implementation**: The system lacks Voice Activity Detection logic to distinguish between speech, silence, and pauses, relying solely on time-based intervals

## Correctness Properties

Property 1: Bug Condition - VAD-Based Question Processing

_For any_ audio input where speech is detected followed by 1.5-2.0 seconds of sustained silence, the fixed system SHALL buffer the complete audio and process it as a single question, regardless of the total duration or number of internal pauses.

**Validates: Requirements 2.1, 2.2, 2.9**

Property 2: Bug Condition - OS-Level Content Protection

_For any_ system state where the stealth overlay window is visible and screen sharing is active, the fixed system SHALL apply OS-specific content protection (Windows: SetContentProtection, macOS: NSScreenSaverWindowLevel) to exclude the window from all screen capture APIs.

**Validates: Requirements 2.5, 2.6**

Property 3: Bug Condition - Pre-flight Audio Checks

_For any_ capture start attempt, the fixed system SHALL perform pre-flight checks for microphone permissions and audio device availability, displaying clear error messages and preventing crashes when checks fail.

**Validates: Requirements 2.3, 2.4**

Property 4: Bug Condition - Session-Long Memory

_For any_ interview session of any duration, the fixed system SHALL maintain full conversation history with rolling summaries, ensuring consistent answers when questions are repeated at any point during the session.

**Validates: Requirements 2.8**

Property 5: Bug Condition - DevTools Disabled in Production

_For any_ application launch in production mode, the fixed system SHALL disable all Developer Tools and prevent openDevTools() from being called, ensuring no accidental exposure during screen sharing.

**Validates: Requirements 2.7**

Property 6: Preservation - Existing Functionality

_For any_ input that does NOT involve the 9 bug conditions (manual stop, answer display, keyboard shortcuts, context uploads, audio accumulation, screen sharing detection), the fixed system SHALL produce exactly the same behavior as the original system.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/main/index.ts` (Electron main process)

**Function**: `createWindow()`

**Specific Changes**:
1. **Enable Content Protection**: Add OS-specific content protection after window creation
   ```typescript
   const mainWindow = new BrowserWindow({ /* existing config */ });
   
   // Enable content protection to hide from screen capture
   if (process.platform === 'win32') {
     mainWindow.setContentProtection(true);
   } else if (process.platform === 'darwin') {
     // macOS: Set window level to screen saver (above normal, hidden from capture)
     mainWindow.setWindowLevel(23); // NSScreenSaverWindowLevel
   }
   ```

2. **Disable DevTools in Production**: Add conditional DevTools disabling
   ```typescript
   if (process.env.NODE_ENV === 'production') {
     mainWindow.webContents.closeDevTools();
     mainWindow.webContents.on('devtools-opened', () => {
       mainWindow.webContents.closeDevTools();
     });
   }
   ```

**File**: `src/renderer/hooks/useAudioCapture.ts`

**Function**: `startCapture()`

**Specific Changes**:
1. **Add Pre-flight Checks**: Validate permissions and devices before capture
   ```typescript
   async function startCapture() {
     // Pre-flight check 1: Verify microphone permission
     try {
       const permissionStatus = await navigator.permissions.query({ 
         name: 'microphone' as PermissionName 
       });
       if (permissionStatus.state === 'denied') {
         setError('Microphone permission denied. Please grant access in browser settings.');
         return;
       }
     } catch (err) {
       console.warn('Permission API not supported, will attempt capture');
     }
     
     // Pre-flight check 2: Verify audio device availability
     try {
       const devices = await navigator.mediaDevices.enumerateDevices();
       const hasAudioInput = devices.some(d => d.kind === 'audioinput');
       if (!hasAudioInput) {
         setError('No audio input device detected. Please connect a microphone.');
         return;
       }
     } catch (err) {
       setError('Failed to enumerate audio devices: ' + err.message);
       return;
     }
     
     // Proceed with existing capture logic...
   }
   ```

2. **Replace Fixed Polling with VAD**: Remove `setInterval`, add VAD logic
   ```typescript
   // Remove: setInterval(processAudio, 10000)
   
   // Add VAD state
   const vadStateRef = useRef({
     isSpeaking: false,
     silenceStart: null as number | null,
     audioBuffer: [] as Blob[],
     silenceThreshold: 1800, // 1.8 seconds
     maxQuestionDuration: 90000 // 90 seconds max
   });
   
   // Add VAD processing in MediaRecorder.ondataavailable
   mediaRecorder.ondataavailable = async (event) => {
     if (event.data.size > 0) {
       const audioLevel = await detectAudioLevel(event.data);
       const now = Date.now();
       
       if (audioLevel > SPEECH_THRESHOLD) {
         // Speech detected
         vadStateRef.current.isSpeaking = true;
         vadStateRef.current.silenceStart = null;
         vadStateRef.current.audioBuffer.push(event.data);
       } else if (vadStateRef.current.isSpeaking) {
         // Silence after speech
         if (!vadStateRef.current.silenceStart) {
           vadStateRef.current.silenceStart = now;
         }
         
         const silenceDuration = now - vadStateRef.current.silenceStart;
         
         if (silenceDuration >= vadStateRef.current.silenceThreshold) {
           // Sustained silence detected - process complete question
           await processCompleteQuestion(vadStateRef.current.audioBuffer);
           vadStateRef.current = {
             ...vadStateRef.current,
             isSpeaking: false,
             silenceStart: null,
             audioBuffer: []
           };
         } else {
           // Still within silence threshold, keep buffering
           vadStateRef.current.audioBuffer.push(event.data);
         }
       }
     }
   };
   ```

3. **Implement Audio Level Detection**: Add helper function for VAD
   ```typescript
   async function detectAudioLevel(audioBlob: Blob): Promise<number> {
     const audioContext = new AudioContext();
     const arrayBuffer = await audioBlob.arrayBuffer();
     const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
     const channelData = audioBuffer.getChannelData(0);
     
     // Calculate RMS (Root Mean Square) for audio level
     let sum = 0;
     for (let i = 0; i < channelData.length; i++) {
       sum += channelData[i] * channelData[i];
     }
     const rms = Math.sqrt(sum / channelData.length);
     
     audioContext.close();
     return rms;
   }
   ```

**File**: `src/renderer/hooks/useConversationMemory.ts` (new file)

**Specific Changes**:
1. **Create Session-Long Memory Hook**: Replace simple array with rolling summary strategy
   ```typescript
   interface ConversationEntry {
     question: string;
     answer: string;
     timestamp: number;
   }
   
   interface MemoryState {
     recentHistory: ConversationEntry[]; // Last 5 Q&A (full detail)
     rolledUpSummary: string; // Compressed older history
     fullHistory: ConversationEntry[]; // Complete session (for lookup)
   }
   
   export function useConversationMemory() {
     const [memory, setMemory] = useState<MemoryState>({
       recentHistory: [],
       rolledUpSummary: '',
       fullHistory: []
     });
     
     const addEntry = async (question: string, answer: string) => {
       const entry = { question, answer, timestamp: Date.now() };
       
       setMemory(prev => {
         const newFullHistory = [...prev.fullHistory, entry];
         const newRecentHistory = [...prev.recentHistory, entry].slice(-5);
         
         // If we have more than 5 entries, roll up the oldest
         let newSummary = prev.rolledUpSummary;
         if (newFullHistory.length > 5) {
           const oldEntries = newFullHistory.slice(0, -5);
           // Call AI to summarize old entries (async, non-blocking)
           summarizeOldEntries(oldEntries).then(summary => {
             setMemory(m => ({ ...m, rolledUpSummary: summary }));
           });
         }
         
         return {
           recentHistory: newRecentHistory,
           rolledUpSummary: newSummary,
           fullHistory: newFullHistory
         };
       });
     };
     
     const getContextForPrompt = () => {
       // Include both rolled-up summary and recent detailed history
       return {
         summary: memory.rolledUpSummary,
         recentQA: memory.recentHistory
       };
     };
     
     const findPreviousAnswer = (question: string): string | null => {
       // Search full history for similar question
       const normalized = question.toLowerCase().trim();
       const match = memory.fullHistory.find(entry => 
         entry.question.toLowerCase().includes(normalized) ||
         normalized.includes(entry.question.toLowerCase())
       );
       return match?.answer || null;
     };
     
     return { addEntry, getContextForPrompt, findPreviousAnswer };
   }
   ```

2. **Implement Rolling Summary**: Add AI-based summarization
   ```typescript
   async function summarizeOldEntries(entries: ConversationEntry[]): Promise<string> {
     const prompt = `Summarize the following interview Q&A history concisely, 
     preserving key technical details and decisions:
     
     ${entries.map(e => `Q: ${e.question}\nA: ${e.answer}`).join('\n\n')}
     
     Provide a brief summary (2-3 sentences) capturing the main topics discussed.`;
     
     const response = await fetch('/api/summarize', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ prompt })
     });
     
     const { summary } = await response.json();
     return summary;
   }
   ```

**File**: `src/renderer/components/InterviewCopilot.tsx`

**Function**: Component integration

**Specific Changes**:
1. **Integrate New Memory Hook**: Replace simple state with useConversationMemory
   ```typescript
   // Remove: const [history, setHistory] = useState<QA[]>([]);
   
   // Add: 
   const { addEntry, getContextForPrompt, findPreviousAnswer } = useConversationMemory();
   ```

2. **Update AI Prompt Construction**: Include rolled-up summary
   ```typescript
   const buildPrompt = (question: string) => {
     const context = getContextForPrompt();
     
     return `
     ${resumeContext}
     ${jobDescriptionContext}
     
     Previous conversation summary: ${context.summary}
     
     Recent Q&A:
     ${context.recentQA.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n')}
     
     Current question: ${question}
     
     Provide a concise, relevant answer.
     `;
   };
   ```

3. **Add Duplicate Question Detection**: Check before processing
   ```typescript
   const processQuestion = async (audioBlob: Blob) => {
     const transcription = await transcribeAudio(audioBlob);
     
     // Check if this question was asked before
     const previousAnswer = findPreviousAnswer(transcription);
     if (previousAnswer) {
       setAnswer(previousAnswer);
       return;
     }
     
     // Generate new answer
     const prompt = buildPrompt(transcription);
     const answer = await callAI(prompt);
     
     await addEntry(transcription, answer);
     setAnswer(answer);
   };
   ```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code, then verify the fixes work correctly and preserve existing behavior. Each bug requires specific test scenarios to validate the fix.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate all 9 bugs BEFORE implementing fixes. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate each bug condition and observe failures on UNFIXED code to understand root causes.

**Test Cases**:

1. **Fixed Polling Bug (1-2)**: Simulate 15-second question with audio chunks (will fail on unfixed code - processes at 10 seconds)
   - Input: Audio stream with speech from 0-15 seconds
   - Expected failure: System processes at 10-second mark, missing last 5 seconds
   - Confirms: Fixed polling architecture is the root cause

2. **Premature Processing Bug**: Simulate question with 3-second pause mid-sentence (will fail on unfixed code)
   - Input: "Can you explain... [3 sec pause]... your approach?"
   - Expected failure: System processes "Can you explain" as complete question
   - Confirms: Lack of VAD causes premature processing

3. **Permission Crash Bug (3)**: Click "Start Capture" without mic permission (will crash on unfixed code)
   - Input: startCapture() called with navigator.permissions.state === 'denied'
   - Expected failure: Uncaught DOMException crashes the app
   - Confirms: Missing pre-flight checks

4. **Device Crash Bug (4)**: Click "Start Capture" with no audio device (will crash on unfixed code)
   - Input: startCapture() called with no audioinput devices
   - Expected failure: TypeError when accessing undefined audio track
   - Confirms: No device availability check

5. **Windows Screen Capture Bug (5)**: Share screen on Windows with overlay visible (will fail on unfixed code)
   - Input: Screen sharing active, stealth window visible, contentProtection === false
   - Expected failure: Overlay appears in shared screen capture
   - Confirms: Missing SetContentProtection API call

6. **macOS Screen Capture Bug (6)**: Share screen on macOS with overlay visible (may fail on unfixed code)
   - Input: Screen sharing active on macOS, window level === normal
   - Expected failure: Overlay may appear depending on capture software
   - Confirms: Window level not set to NSScreenSaverWindowLevel

7. **DevTools Exposure Bug (7)**: Launch in production with DevTools open (will fail on unfixed code)
   - Input: NODE_ENV=production, DevTools manually opened
   - Expected failure: DevTools remain visible and accessible
   - Confirms: No DevTools disabling logic in production

8. **Memory Limitation Bug (8)**: Ask same question at minute 5 and minute 40 (will fail on unfixed code)
   - Input: 30+ Q&A pairs, then repeat question from pair #3
   - Expected failure: Different answer provided (original Q&A evicted from memory)
   - Confirms: Naive .slice(-5) memory strategy

9. **Multi-part Question Bug (9)**: Ask question with multiple pauses (will fail on unfixed code)
   - Input: "What's your experience with... [pause]... React and... [pause]... TypeScript?"
   - Expected failure: Treated as 3 separate questions
   - Confirms: No VAD to accumulate multi-part questions

**Expected Counterexamples**:
- Fixed polling processes audio at wrong times (too early or too late)
- Screen capture shows overlay window on interviewer's screen
- App crashes when permissions/devices are missing
- Inconsistent answers for repeated questions in long sessions
- Multi-part questions fragmented into separate questions
- DevTools visible during production screen sharing

### Fix Checking

**Goal**: Verify that for all inputs where bug conditions hold, the fixed system produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedSystem(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Specific Fix Validation:**

1. **VAD Fix Validation**: Test questions of varying lengths and pause patterns
   - 15-second question → Processes after 1.8 seconds of silence, not at 10 seconds
   - Question with 3-second pause → Buffers complete question, processes once
   - Multi-part question → Accumulates all parts, processes as single question

2. **Content Protection Fix Validation**: Test screen capture on both platforms
   - Windows: Verify SetContentProtection(true) excludes window from capture
   - macOS: Verify window level 23 hides window from capture APIs

3. **Pre-flight Fix Validation**: Test permission and device scenarios
   - No permission → Clear error message, no crash
   - No device → Clear error message, no crash
   - Permission granted + device present → Capture starts normally

4. **Memory Fix Validation**: Test long session scenarios
   - 50 Q&A pairs → All stored in fullHistory
   - Repeat question from pair #5 → Same answer retrieved
   - Recent 5 Q&A → Full detail in prompt
   - Older Q&A → Rolled-up summary in prompt

5. **DevTools Fix Validation**: Test production mode
   - Production launch → DevTools closed and disabled
   - Attempt to open DevTools → Immediately closed
   - Development mode → DevTools remain available

### Preservation Checking

**Goal**: Verify that for all inputs where bug conditions do NOT hold, the fixed system produces the same result as the original system.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalSystem(input) = fixedSystem(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-bug scenarios, then write property-based tests capturing that behavior.

**Test Cases**:

1. **Manual Stop Preservation**: Observe that clicking "Stop Capture" immediately halts audio on unfixed code, then verify this continues after fix
   - Input: User clicks stop button during active capture
   - Expected: Immediate stop, resource cleanup (same as before)

2. **Answer Display Preservation**: Observe that AI answers display correctly on unfixed code, then verify this continues after fix
   - Input: Valid question processed, answer generated
   - Expected: Answer appears in overlay window (same as before)

3. **Keyboard Shortcut Preservation**: Observe that Cmd+Shift+A toggles visibility on unfixed code, then verify this continues after fix
   - Input: User presses keyboard shortcut
   - Expected: Overlay visibility toggles (same as before)

4. **Context Upload Preservation**: Observe that resume/job description are included in prompts on unfixed code, then verify this continues after fix
   - Input: User uploads context files before session
   - Expected: Context included in AI prompts (same as before)

5. **Audio Accumulation Preservation**: Observe that audio chunks accumulate when speech detected on unfixed code, then verify this continues after fix
   - Input: Speech above volume threshold
   - Expected: Chunks added to buffer (same as before)

6. **Screen Sharing Preservation**: Observe that system audio capture works on unfixed code, then verify this continues after fix
   - Input: User grants screen sharing with audio
   - Expected: Audio captured from meeting tab (same as before)

7. **MediaRecorder Preservation**: Observe that ondataavailable accumulates chunks on unfixed code, then verify this continues after fix
   - Input: MediaRecorder receives audio data
   - Expected: Chunks added to audioChunksRef (same as before)

8. **Track End Preservation**: Observe that track.onended stops capture on unfixed code, then verify this continues after fix
   - Input: User stops screen sharing from browser
   - Expected: Capture stops gracefully (same as before)

### Unit Tests

- Test VAD audio level detection with various audio samples (silence, speech, noise)
- Test pre-flight permission check with granted/denied/prompt states
- Test pre-flight device check with 0, 1, and multiple audio devices
- Test content protection API calls on Windows and macOS
- Test DevTools disabling in production vs development mode
- Test conversation memory addition, retrieval, and summarization
- Test duplicate question detection with exact and similar questions
- Test rolling summary generation with various history sizes

### Property-Based Tests

- Generate random audio streams with varying speech/silence patterns, verify VAD correctly identifies question boundaries
- Generate random permission states and device configurations, verify pre-flight checks handle all cases without crashing
- Generate random conversation histories (5-100 Q&A pairs), verify memory retrieval is consistent
- Generate random question variations, verify duplicate detection works for paraphrased questions
- Generate random screen sharing states, verify content protection is applied when needed

### Integration Tests

- Test full interview flow: start capture → ask question → receive answer → repeat 10 times → verify all answers stored
- Test long session: simulate 1-hour interview with 30 Q&A pairs, repeat question from beginning, verify consistent answer
- Test multi-platform: run on Windows and macOS, verify content protection works on both
- Test error scenarios: deny permissions → see error → grant permissions → retry → success
- Test screen sharing: start screen share → verify overlay hidden → stop share → verify overlay visible locally
- Test DevTools: launch in production → attempt to open DevTools → verify they remain closed
- Test VAD edge cases: very long question (80 seconds), very short question (2 seconds), question with multiple long pauses
