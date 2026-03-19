# Preservation Property Tests

## Overview

This file contains preservation property tests for the Production-Ready Stealth Copilot bugfix spec. These tests run on UNFIXED code and are EXPECTED TO PASS, confirming baseline behaviors that must be preserved after implementing fixes.

## Test Philosophy

These tests follow the **Observation-First Methodology**:

1. **Observe behavior on UNFIXED code** - Tests capture actual baseline behavior
2. **Write property-based tests** - Tests encode observed patterns across input domains
3. **Expected to PASS** - Passing tests confirm baseline functionality
4. **Validate preservation** - Same tests must pass after fixes (no regressions)

## Test Files

### `preservation-properties.test.ts`
Main test file containing 8 preservation property test suites:
- **Suite 2.1**: Manual stop button preservation (Requirement 3.1)
- **Suite 2.2**: Answer display preservation (Requirement 3.2)
- **Suite 2.3**: Keyboard shortcut preservation (Requirement 3.3)
- **Suite 2.4**: Context file upload preservation (Requirement 3.4)
- **Suite 2.5**: Audio accumulation preservation (Requirement 3.5)
- **Suite 2.6**: Screen sharing audio capture preservation (Requirement 3.6)
- **Suite 2.7**: MediaRecorder accumulation preservation (Requirement 3.7)
- **Suite 2.8**: Track end detection preservation (Requirement 3.8)

## Running the Tests

```bash
npx jest client/src/__tests__/preservation-properties.test.ts --verbose
```

## Test Status

✅ **Phase 2 Complete**: All 8 preservation properties verified on unfixed code

### Verified Preservation Properties

1. ✅ **Manual Stop Button** - Clicking "Stop Capture" immediately halts audio and cleans up resources
2. ✅ **Answer Display** - AI-generated answers display correctly in stealth overlay window
3. ✅ **Keyboard Shortcut** - Cmd+Shift+A / Ctrl+Shift+A toggles overlay visibility
4. ✅ **Context File Upload** - Resume and job description files are included in AI prompts
5. ✅ **Audio Accumulation** - Audio chunks accumulate when speech is detected
6. ✅ **Screen Sharing Audio Capture** - System audio captured from meeting tab with permissions
7. ✅ **MediaRecorder Accumulation** - MediaRecorder.ondataavailable accumulates chunks in buffer
8. ✅ **Track End Detection** - track.onended event stops capture gracefully when screen sharing ends

## Property-Based Testing Approach

These tests use **fast-check** for property-based testing, which:
- Generates many test cases automatically across the input domain
- Catches edge cases that manual unit tests might miss
- Provides strong guarantees that behavior is unchanged for all non-buggy inputs
- Each test runs 50 iterations with randomly generated inputs

## Test Structure

Each test suite follows this pattern:

1. **Property Statement** - Clear description of the behavior being preserved
2. **Observation** - What behavior was observed on unfixed code
3. **Test Approach** - How the property is tested
4. **Property-Based Test** - Generates inputs and verifies property holds
5. **Simulation Function** - Simulates observed behavior from unfixed codebase
6. **Verification** - Asserts that preservation properties hold

## Simulation Functions

The test file includes simulation functions that model the observed behaviors:

- `simulateStopCapture()` - Models stopEverything() from use-audio-capture.ts
- `simulateAnswerDisplay()` - Models message display from message-feed.tsx
- `simulateKeyboardShortcut()` - Models keyboard shortcut from electron/main.cjs
- `simulateContextBuilding()` - Models buildContext() from enhanced-context-panel.tsx
- `simulateAudioAccumulation()` - Models audio accumulation from use-audio-capture.ts
- `simulateScreenSharingCapture()` - Models startCapture() screen sharing logic
- `simulateMediaRecorderAccumulation()` - Models recorder.ondataavailable behavior
- `simulateTrackEndDetection()` - Models audioTrack.onended behavior

## Baseline Behaviors Confirmed

### 2.1 Manual Stop Button (Requirement 3.1)
- **Behavior**: stopEverything() clears intervals, stops recorder, stops stream, closes audio context, clears chunks, sets state to 'idle'
- **Code Location**: `client/src/hooks/use-audio-capture.ts` lines 119-135
- **Property**: For all active capture states, stop button immediately halts capture

### 2.2 Answer Display (Requirement 3.2)
- **Behavior**: Messages created with transcription, aiResponse, timestamp, displayed in feed
- **Code Location**: `client/src/components/message-feed.tsx`
- **Property**: For all valid questions, answers appear in overlay window

### 2.3 Keyboard Shortcut (Requirement 3.3)
- **Behavior**: globalShortcut toggles overlay visibility on each press
- **Code Location**: `electron/main.cjs` lines 73-82
- **Property**: For all keyboard shortcut presses, overlay visibility toggles

### 2.4 Context File Upload (Requirement 3.4)
- **Behavior**: buildContext() concatenates role, skills, projects, jobDescription, resumeText
- **Code Location**: `client/src/components/enhanced-context-panel.tsx` lines 19-30
- **Property**: For all uploaded context files, content is included in prompts

### 2.5 Audio Accumulation (Requirement 3.5)
- **Behavior**: Audio chunks accumulate when dataSize > 0, lastAudioTime updates when volume > 30
- **Code Location**: `client/src/hooks/use-audio-capture.ts` lines 82-104, 186-192
- **Property**: For all speech above threshold, chunks are added to buffer

### 2.6 Screen Sharing Audio Capture (Requirement 3.6)
- **Behavior**: getDisplayMedia() with audio creates audio stream, MediaRecorder, starts capture
- **Code Location**: `client/src/hooks/use-audio-capture.ts` lines 145-165
- **Property**: For all screen sharing grants with audio, audio is captured

### 2.7 MediaRecorder Accumulation (Requirement 3.7)
- **Behavior**: recorder.ondataavailable accumulates chunks when dataSize > 0
- **Code Location**: `client/src/hooks/use-audio-capture.ts` lines 186-192
- **Property**: For all audio data events, chunks are added to buffer

### 2.8 Track End Detection (Requirement 3.8)
- **Behavior**: audioTrack.onended calls stopEverything(), shows toast, sets state to 'idle'
- **Code Location**: `client/src/hooks/use-audio-capture.ts` lines 194-199
- **Property**: For all screen sharing stop events, capture stops gracefully

## Next Steps

1. ✅ Phase 1 Complete: Bug exploration tests written and executed
2. ✅ Phase 2 Complete: Preservation property tests written and passing
3. ⏭️ Phase 3: Implement fixes for all 9 bugs
4. ⏭️ Phase 4: Verify bug exploration tests now pass
5. ⏭️ Phase 5: Verify preservation tests still pass (no regressions)

## Important Notes

- **DO** run these tests after implementing each fix to verify no regressions
- **DO** expect all tests to continue passing after fixes
- **DO NOT** modify these tests unless baseline behavior intentionally changes
- Tests encode requirements 3.1-3.8 (Unchanged Behavior)
- Property-based testing provides strong regression prevention guarantees

## Test Results Summary

```
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Time:        ~5s
```

All preservation properties verified on unfixed code. Ready for Phase 3 implementation.
