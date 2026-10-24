# Implementation Plan

## Phase 1: Bug Condition Exploration Tests (BEFORE Fix)

- [x] 1. Write bug condition exploration tests for all 9 bugs
  - **Property 1: Bug Condition** - Production-Ready Stealth Copilot Bugs
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failures confirm the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each bug exists
  - **Scoped PBT Approach**: For deterministic bugs, scope properties to concrete failing cases to ensure reproducibility
  - Test implementation details from Bug Condition in design
  - The test assertions should match the Expected Behavior Properties from design
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples found to understand root causes
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 1.1 Test Bug 1-2: Fixed polling issues
    - Simulate 15-second question with continuous speech
    - Expected failure: System processes at 10-second mark, missing last 5 seconds
    - Simulate question with 3-second mid-sentence pause
    - Expected failure: System prematurely processes partial question
    - Confirms: Fixed polling architecture is the root cause
    - _Requirements: 2.1, 2.2, 2.9_

  - [x] 1.2 Test Bug 3-4: Missing pre-flight checks
    - Call startCapture() with microphone permission denied
    - Expected failure: Uncaught DOMException crashes the app
    - Call startCapture() with no audio input devices
    - Expected failure: TypeError when accessing undefined audio track
    - Confirms: Missing pre-flight validation
    - _Requirements: 2.3, 2.4_

  - [x] 1.3 Test Bug 5-6: Screen capture visibility
    - Activate screen sharing on Windows with overlay visible
    - Expected failure: Overlay appears in screen capture (contentProtection === false)
    - Activate screen sharing on macOS with overlay visible
    - Expected failure: Overlay may appear depending on window level
    - Confirms: Missing OS-level content protection APIs
    - _Requirements: 2.5, 2.6_

  - [x] 1.4 Test Bug 7: DevTools exposure
    - Launch app in production mode (NODE_ENV=production)
    - Attempt to open DevTools manually
    - Expected failure: DevTools remain visible and accessible
    - Confirms: No DevTools disabling logic in production
    - _Requirements: 2.7_

  - [x] 1.5 Test Bug 8-9: Memory limitations
    - Simulate 30+ Q&A pairs, then repeat question from pair #3
    - Expected failure: Different answer provided (original Q&A evicted from memory)
    - Ask multi-part question: "What's your experience with... [pause]... React and... [pause]... TypeScript?"
    - Expected failure: Treated as 3 separate questions
    - Confirms: Naive .slice(-5) memory strategy and lack of VAD
    - _Requirements: 2.8_

## Phase 2: Preservation Property Tests (BEFORE Fix)

- [x] 2. Write preservation property tests (BEFORE implementing fixes)
  - **Property 2: Preservation** - Existing Functionality Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 2.1 Test manual stop button preservation
    - Observe: Clicking "Stop Capture" immediately halts audio and cleans up resources on unfixed code
    - Write property-based test: for all active capture states, stop button immediately halts capture
    - Verify test passes on UNFIXED code
    - _Requirements: 3.1_

  - [x] 2.2 Test answer display preservation
    - Observe: AI-generated answers display correctly in stealth overlay on unfixed code
    - Write property-based test: for all valid questions, answers appear in overlay window
    - Verify test passes on UNFIXED code
    - _Requirements: 3.2_

  - [x] 2.3 Test keyboard shortcut preservation
    - Observe: Cmd+Shift+A / Ctrl+Shift+A toggles overlay visibility on unfixed code
    - Write property-based test: for all keyboard shortcut presses, overlay visibility toggles
    - Verify test passes on UNFIXED code
    - _Requirements: 3.3_

  - [x] 2.4 Test context file upload preservation
    - Observe: Resume and job description files are included in AI prompts on unfixed code
    - Write property-based test: for all uploaded context files, content is included in prompts
    - Verify test passes on UNFIXED code
    - _Requirements: 3.4_

  - [x] 2.5 Test audio accumulation preservation
    - Observe: Audio chunks accumulate when speech is detected above volume threshold on unfixed code
    - Write property-based test: for all speech above threshold, chunks are added to buffer
    - Verify test passes on UNFIXED code
    - _Requirements: 3.5_

  - [x] 2.6 Test screen sharing audio capture preservation
    - Observe: System audio capture from meeting tab works with screen sharing permissions on unfixed code
    - Write property-based test: for all screen sharing grants with audio, audio is captured
    - Verify test passes on UNFIXED code
    - _Requirements: 3.6_

  - [x] 2.7 Test MediaRecorder accumulation preservation
    - Observe: MediaRecorder.ondataavailable accumulates chunks in audioChunksRef on unfixed code
    - Write property-based test: for all audio data events, chunks are added to buffer
    - Verify test passes on UNFIXED code
    - _Requirements: 3.7_

  - [x] 2.8 Test track end detection preservation
    - Observe: track.onended event stops capture gracefully when screen sharing ends on unfixed code
    - Write property-based test: for all screen sharing stop events, capture stops gracefully
    - Verify test passes on UNFIXED code
    - _Requirements: 3.8_

## Phase 3: Implementation

- [x] 3. Fix Bug 5-6: OS-level content protection for stealth mode

  - [x] 3.1 Implement content protection in Electron main process
    - File: `src/main/index.ts`
    - Function: `createWindow()`
    - Add Windows SetContentProtection API call after window creation
    - Add macOS window level configuration (NSScreenSaverWindowLevel = 23)
    - Ensure content protection is applied before window is shown
    - _Bug_Condition: (input.stealthWindowVisible == true AND input.screenSharingActive == true AND input.contentProtectionEnabled == false)_
    - _Expected_Behavior: OS-specific content protection excludes window from all screen capture APIs_
    - _Preservation: All existing window behaviors (visibility, focus, keyboard shortcuts) remain unchanged_
    - _Requirements: 2.5, 2.6, 3.1, 3.2, 3.3_

  - [x] 3.2 Verify content protection exploration test now passes
    - **Property 1: Expected Behavior** - OS-Level Content Protection
    - **IMPORTANT**: Re-run the SAME test from task 1.3 - do NOT write a new test
    - The test from task 1.3 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run screen capture visibility tests from step 1.3
    - **EXPECTED OUTCOME**: Test PASSES (confirms overlay is hidden from screen capture)
    - _Requirements: 2.5, 2.6_

  - [x] 3.3 Verify window behavior preservation tests still pass
    - **Property 2: Preservation** - Window Behaviors Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2.2, 2.3 - do NOT write new tests
    - Run answer display and keyboard shortcut tests from step 2.2, 2.3
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in window behavior)

- [x] 4. Fix Bug 7: DevTools disabled in production mode

  - [x] 4.1 Implement DevTools disabling in production
    - File: `src/main/index.ts`
    - Function: `createWindow()`
    - Add conditional check for NODE_ENV === 'production'
    - Call mainWindow.webContents.closeDevTools() in production
    - Add devtools-opened event listener to prevent reopening
    - Ensure DevTools remain available in development mode
    - _Bug_Condition: (input.productionMode == true AND input.devToolsEnabled == true)_
    - _Expected_Behavior: DevTools are closed and disabled in production, preventing accidental exposure_
    - _Preservation: DevTools remain available in development mode, all other window behaviors unchanged_
    - _Requirements: 2.7, 3.1, 3.2, 3.3_

  - [x] 4.2 Verify DevTools exploration test now passes
    - **Property 1: Expected Behavior** - DevTools Disabled in Production
    - **IMPORTANT**: Re-run the SAME test from task 1.4 - do NOT write a new test
    - Run DevTools exposure test from step 1.4
    - **EXPECTED OUTCOME**: Test PASSES (confirms DevTools are disabled in production)
    - _Requirements: 2.7_

  - [x] 4.3 Verify development mode still allows DevTools
    - **Property 2: Preservation** - DevTools Available in Development
    - Verify DevTools can be opened in development mode (NODE_ENV !== 'production')
    - **EXPECTED OUTCOME**: DevTools open successfully in development

- [x] 5. Fix Bug 3-4: Pre-flight checks for audio permissions and devices

  - [x] 5.1 Implement pre-flight checks in startCapture
    - File: `src/renderer/hooks/useAudioCapture.ts`
    - Function: `startCapture()`
    - Add microphone permission check using navigator.permissions.query()
    - Display clear error message if permission is denied
    - Add audio device availability check using navigator.mediaDevices.enumerateDevices()
    - Display clear error message if no audio input device is found
    - Return early from startCapture if checks fail (prevent crashes)
    - Proceed with existing capture logic only if checks pass
    - _Bug_Condition: (input.captureStarted == true AND (input.micPermission == "NOT_GRANTED" OR input.audioDevice == null))_
    - _Expected_Behavior: Pre-flight checks validate permissions and devices, displaying clear errors and preventing crashes_
    - _Preservation: Normal capture flow when permissions granted and devices present remains unchanged_
    - _Requirements: 2.3, 2.4, 3.5, 3.6, 3.7_

  - [x] 5.2 Verify pre-flight checks exploration test now passes
    - **Property 1: Expected Behavior** - Pre-flight Audio Checks
    - **IMPORTANT**: Re-run the SAME test from task 1.2 - do NOT write a new test
    - Run permission and device crash tests from step 1.2
    - **EXPECTED OUTCOME**: Test PASSES (confirms graceful error handling, no crashes)
    - _Requirements: 2.3, 2.4_

  - [x] 5.3 Verify normal capture flow preservation tests still pass
    - **Property 2: Preservation** - Normal Capture Flow Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2.5, 2.6, 2.7 - do NOT write new tests
    - Run audio accumulation and screen sharing tests from step 2.5, 2.6, 2.7
    - **EXPECTED OUTCOME**: Tests PASS (confirms normal capture still works)

- [x] 6. Fix Bug 1-2: VAD-based audio processing (replaces fixed 10-second polling)

  - [x] 6.1 Implement Voice Activity Detection (VAD)
    - File: `src/renderer/hooks/useAudioCapture.ts`
    - Remove fixed 10-second polling: delete setInterval(processAudio, 10000)
    - Add VAD state tracking: isSpeaking, silenceStart, audioBuffer, silenceThreshold (1800ms)
    - Implement audio level detection helper function using AudioContext and RMS calculation
    - Modify MediaRecorder.ondataavailable to detect speech vs silence
    - Buffer audio chunks during speech and short pauses
    - Process complete question after 1.8 seconds of sustained silence
    - Add max question duration safeguard (90 seconds)
    - _Bug_Condition: (input.audioProcessingMode == "FIXED_10_SEC_POLLING" AND (input.questionDuration > 10 OR input.pauseDuration < 10))_
    - _Expected_Behavior: VAD-based processing buffers complete audio and processes after sustained silence, regardless of duration or pauses_
    - _Preservation: Audio chunk accumulation, MediaRecorder behavior, and track end detection remain unchanged_
    - _Requirements: 2.1, 2.2, 2.9, 3.5, 3.7, 3.8_

  - [x] 6.2 Implement audio level detection helper
    - File: `src/renderer/hooks/useAudioCapture.ts`
    - Create detectAudioLevel(audioBlob: Blob): Promise<number> function
    - Use AudioContext to decode audio blob
    - Calculate RMS (Root Mean Square) for audio level
    - Return normalized audio level for VAD comparison
    - Clean up AudioContext after processing
    - _Requirements: 2.1, 2.2_

  - [x] 6.3 Verify VAD exploration test now passes
    - **Property 1: Expected Behavior** - VAD-Based Question Processing
    - **IMPORTANT**: Re-run the SAME test from task 1.1 - do NOT write a new test
    - Run fixed polling tests from step 1.1
    - **EXPECTED OUTCOME**: Test PASSES (confirms VAD processes questions correctly)
    - _Requirements: 2.1, 2.2, 2.9_

  - [x] 6.4 Verify audio processing preservation tests still pass
    - **Property 2: Preservation** - Audio Processing Behaviors Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2.1, 2.5, 2.7, 2.8 - do NOT write new tests
    - Run manual stop, audio accumulation, MediaRecorder, and track end tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in audio processing)

- [x] 7. Fix Bug 8-9: Session-long memory with rolling summaries

  - [x] 7.1 Create conversation memory hook
    - File: `src/renderer/hooks/useConversationMemory.ts` (new file)
    - Define ConversationEntry and MemoryState interfaces
    - Implement useConversationMemory hook with state management
    - Store full conversation history (all Q&A pairs)
    - Maintain recent 5 Q&A in full detail
    - Implement rolling summary for older entries (beyond 5)
    - Implement addEntry function to add new Q&A pairs
    - Implement getContextForPrompt to return summary + recent Q&A
    - Implement findPreviousAnswer to search full history for duplicate questions
    - _Bug_Condition: (input.conversationHistory.length > 5 AND input.memoryStrategy == "LAST_5_ONLY")_
    - _Expected_Behavior: Session-long memory maintains full history with rolling summaries, ensuring consistent answers_
    - _Preservation: Answer display and context file upload behaviors remain unchanged_
    - _Requirements: 2.8, 3.2, 3.4_

  - [x] 7.2 Implement rolling summary generation
    - File: `src/renderer/hooks/useConversationMemory.ts`
    - Create summarizeOldEntries function for AI-based summarization
    - Call AI API to compress old Q&A entries into brief summary
    - Preserve key technical details and decisions in summary
    - Update rolledUpSummary state asynchronously (non-blocking)
    - _Requirements: 2.8_

  - [x] 7.3 Integrate memory hook into InterviewCopilot component
    - File: `src/renderer/components/InterviewCopilot.tsx`
    - Replace simple history state with useConversationMemory hook
    - Update buildPrompt to include rolled-up summary and recent Q&A
    - Add duplicate question detection in processQuestion
    - Return previous answer if question was asked before
    - Call addEntry after generating new answers
    - _Requirements: 2.8, 3.2, 3.4_

  - [x] 7.4 Verify memory exploration test now passes
    - **Property 1: Expected Behavior** - Session-Long Memory
    - **IMPORTANT**: Re-run the SAME test from task 1.5 - do NOT write a new test
    - Run memory limitation tests from step 1.5
    - **EXPECTED OUTCOME**: Test PASSES (confirms consistent answers for repeated questions)
    - _Requirements: 2.8_

  - [x] 7.5 Verify answer display and context preservation tests still pass
    - **Property 2: Preservation** - Answer Display and Context Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2.2, 2.4 - do NOT write new tests
    - Run answer display and context upload tests from step 2.2, 2.4
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in answer handling)

## Phase 4: Final Validation

- [x] 8. Checkpoint - Ensure all tests pass
  - Re-run all bug condition exploration tests (should now PASS)
  - Re-run all preservation property tests (should still PASS)
  - Verify no regressions in existing functionality
  - Test full interview flow end-to-end
  - Test on both Windows and macOS platforms
  - Ask the user if questions arise or if additional testing is needed
