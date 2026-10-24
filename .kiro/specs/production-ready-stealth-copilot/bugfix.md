# Bugfix Requirements Document

## Introduction

The Interview Copilot prototype has several critical defects that prevent it from being production-ready and undetectable during video interviews. The primary issues are: (1) fixed 10-second audio polling that fragments questions and reduces AI accuracy, (2) incomplete stealth mode that remains visible during screen sharing on Windows, (3) crash on audio capture start due to missing permission checks, and (4) limited conversation memory (5 Q&A) causing inconsistent answers during long interviews.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the interviewer asks a question longer than 10 seconds THEN the system processes incomplete audio fragments instead of waiting for the complete question

1.2 WHEN the interviewer pauses briefly mid-question (less than 10 seconds) THEN the system prematurely processes partial audio and generates irrelevant answers

1.3 WHEN the user clicks "Start Capture" without granting microphone permissions THEN the system crashes with an uncaught exception

1.4 WHEN the user clicks "Start Capture" with no active audio device connected THEN the system crashes attempting to access undefined audio track

1.5 WHEN the stealth overlay window is visible on Windows during screen sharing THEN the window appears in the shared screen capture instead of being excluded

1.6 WHEN the stealth overlay window is visible on macOS during screen sharing THEN the window may appear in the shared screen capture depending on the screen sharing software

1.7 WHEN Developer Tools are enabled in development mode THEN the DevTools window can accidentally appear during production use and expose the copilot

1.8 WHEN an interviewer repeats a question after 30+ minutes THEN the system provides a different answer because conversation history only retains the last 5 Q&A pairs

1.9 WHEN the interviewer asks a multi-part question with natural pauses THEN the system treats each part as a separate question instead of accumulating the complete context

### Expected Behavior (Correct)

2.1 WHEN the interviewer asks a question of any length (up to 90 seconds) THEN the system SHALL buffer the complete audio and only process after detecting 1.5-2.0 seconds of silence following speech

2.2 WHEN the interviewer pauses briefly mid-question THEN the system SHALL continue buffering audio without processing until a sustained silence threshold (1.5-2.0 seconds) is detected

2.3 WHEN the user clicks "Start Capture" without microphone permissions THEN the system SHALL display a clear error message prompting the user to grant permissions and SHALL NOT crash

2.4 WHEN the user clicks "Start Capture" with no active audio device THEN the system SHALL perform a pre-flight check, detect the missing device, and display an error message without crashing

2.5 WHEN the stealth overlay window is visible on Windows during screen sharing THEN the system SHALL use SetContentProtection(true) to exclude the window from all screen capture APIs

2.6 WHEN the stealth overlay window is visible on macOS during screen sharing THEN the system SHALL set window level to screen-saver (NSScreenSaverWindowLevel) to remain hidden from screen capture

2.7 WHEN the application launches in production mode THEN the system SHALL disable all Developer Tools and prevent openDevTools() from being called

2.8 WHEN an interviewer repeats a question at any point during a 1+ hour session THEN the system SHALL retrieve the previous answer from the full session memory and provide a consistent response

2.9 WHEN the interviewer asks a multi-part question with natural pauses THEN the system SHALL use Voice Activity Detection (VAD) to accumulate all parts and process as a single complete question

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user manually clicks "Stop Capture" THEN the system SHALL CONTINUE TO immediately stop audio capture and clean up all resources

3.2 WHEN audio is successfully captured and processed THEN the system SHALL CONTINUE TO display the AI-generated answer in the stealth overlay window

3.3 WHEN the user presses Cmd+Shift+A (or Ctrl+Shift+A on Windows) THEN the system SHALL CONTINUE TO toggle the stealth overlay visibility

3.4 WHEN the user uploads context files (resume, job description) before a session THEN the system SHALL CONTINUE TO include this context in the AI prompt

3.5 WHEN the audio capture detects valid speech above the volume threshold THEN the system SHALL CONTINUE TO accumulate audio chunks for processing

3.6 WHEN the user grants screen sharing permissions with audio enabled THEN the system SHALL CONTINUE TO capture system audio from the meeting tab

3.7 WHEN the MediaRecorder receives audio data THEN the system SHALL CONTINUE TO accumulate chunks in the audioChunksRef buffer

3.8 WHEN the user stops screen sharing from the browser THEN the system SHALL CONTINUE TO detect the track.onended event and stop capture gracefully
