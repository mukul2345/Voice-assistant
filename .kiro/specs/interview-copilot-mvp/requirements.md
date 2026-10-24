# Requirements Document

## Introduction

Interview Copilot MVP is a bootstrapped AI-powered desktop application that assists users during live interviews. It captures system audio from browser-based meeting tabs, transcribes interviewer questions in real time using Groq's free-tier Whisper API, and generates context-aware answer suggestions using Groq Llama 3.3 70B. The application runs as an Electron desktop app (macOS + Windows) with a stealth overlay hidden from screen capture. Revenue is generated through a freemium model: a 1-hour trial tracked by accumulated audio processing time, followed by a monthly Stripe subscription ($19-29/month). All user data is stored locally in SQLite with JWT-based authentication and server-side trial enforcement.

## Glossary

- **Application**: The Interview Copilot Electron desktop application (client + server + Electron shell)
- **Backend**: The Express.js server running on localhost, handling authentication, business logic, and API routing
- **Main_Window**: The primary Electron BrowserWindow providing full app UI (auth, context setup, capture control, history)
- **Stealth_Overlay**: The always-on-top, content-protected Electron BrowserWindow displaying the latest AI response
- **Audio_Capture_Engine**: The client-side subsystem capturing system audio from browser tabs via getDisplayMedia
- **VAD_Module**: The Voice Activity Detection module that segments speech from silence to identify complete questions
- **Transcription_Service**: The server-side component that sends audio to Groq Whisper API for speech-to-text conversion
- **AI_Response_Generator**: The server-side component that sends transcribed questions plus context to Groq Llama for answer generation
- **Context_Manager**: The subsystem managing interview session context (resume text, JD, company info, skills, notes)
- **Screen_Capture_Module**: The component that captures screen frames for coding question extraction via vision API
- **Auth_Module**: The server-side authentication subsystem handling JWT access tokens, refresh tokens, and password hashing
- **Trial_Manager**: The server-side subsystem tracking and enforcing the 1-hour free trial via accumulated audio processing time
- **Subscription_Manager**: The server-side subsystem managing Stripe Checkout, webhook handling, and subscription lifecycle
- **Local_Database**: The SQLite database storing user credentials, trial state, subscription status, sessions, and context
- **Session**: A single interview context configuration (company, JD, resume, skills, notes) persisted across app restarts
- **Filler_Filter**: The component that detects and discards non-substantive audio (filler words, silence, noise)
- **Auto_Updater**: The electron-updater component checking GitHub Releases for new versions
- **Conversation_Memory**: The rolling summary of older Q&A pairs plus the last 5 full exchanges used for AI context
- **Machine_Fingerprint**: Not used in this MVP (trial is server-side, tied to user email)

## Requirements

### Requirement 1: User Authentication with JWT

**User Story:** As a user, I want to sign up and log in with email and password, so that my interview data is secured and my trial/subscription state is tied to my account.

#### Acceptance Criteria

1. WHEN a user registers with email and password, THE Auth_Module SHALL hash the password using bcrypt with a minimum cost factor of 10 and store the credentials in the Local_Database
2. WHEN a user submits valid credentials, THE Auth_Module SHALL issue a JWT access token (15-minute expiry) and a refresh token (7-day expiry)
3. WHEN a user submits invalid credentials, THE Auth_Module SHALL return a generic "invalid email or password" error without revealing which field is incorrect
4. WHEN a valid refresh token is presented, THE Auth_Module SHALL issue a new access token without requiring re-authentication
5. WHEN a user logs out, THE Auth_Module SHALL invalidate the refresh token in the Local_Database
6. THE Auth_Module SHALL reject all protected API requests that do not include a valid, non-expired access token
7. IF a duplicate email registration is attempted, THEN THE Auth_Module SHALL reject the request with an "email already registered" error

### Requirement 2: Time-Based Trial System

**User Story:** As the developer, I want a server-enforced 1-hour trial tied to user email, so that users experience the product before subscribing while preventing trial abuse.

#### Acceptance Criteria

1. THE Trial_Manager SHALL provide 1 hour of total accumulated audio processing time to each new user account at no cost
2. WHILE audio is being processed, THE Trial_Manager SHALL increment the user's usage counter by the duration of each processed audio segment
3. THE Trial_Manager SHALL store trial usage permanently in the Local_Database, tied to the user's email address
4. WHEN trial time is exhausted, THE Backend SHALL reject audio processing requests and return an error indicating trial expiration with a link to subscribe
5. THE Trial_Manager SHALL enforce trial limits server-side, independent of client-side timer display
6. WHEN a user logs out and logs back in, THE Trial_Manager SHALL retain the accumulated usage from prior sessions
7. IF a user reinstalls the Application and registers with the same email, THEN THE Trial_Manager SHALL detect the existing account and retain the prior trial usage

### Requirement 3: Stripe Subscription Management

**User Story:** As a user, I want to subscribe via Stripe after my trial ends, so that I can continue using the interview assistant with a monthly payment.

#### Acceptance Criteria

1. WHEN a user initiates subscription, THE Subscription_Manager SHALL create a Stripe Checkout session for the monthly plan and redirect the user to the Stripe-hosted payment page
2. WHEN Stripe sends a checkout.session.completed webhook, THE Subscription_Manager SHALL activate the subscription and store the status in the Local_Database
3. WHEN Stripe sends a customer.subscription.deleted or invoice.payment_failed webhook, THE Subscription_Manager SHALL mark the subscription as inactive in the Local_Database
4. WHILE a user has an active subscription, THE Backend SHALL allow unlimited audio processing without trial time checks
5. WHEN a subscription expires, THE Subscription_Manager SHALL provide a 3-day grace period before revoking access to audio processing
6. THE Subscription_Manager SHALL store the Stripe customer ID, subscription ID, and subscription status in the Local_Database
7. THE Subscription_Manager SHALL verify webhook signatures using the Stripe webhook secret to prevent spoofed events

### Requirement 4: Interview Context Management

**User Story:** As a user, I want to configure interview context with my resume, job description, and company details, so that AI responses are personalized to my specific interview.

#### Acceptance Criteria

1. WHEN a user creates an interview session, THE Context_Manager SHALL accept and store: company name, job description text, resume text, skills list, and free-form notes
2. WHEN a user uploads a resume file, THE Context_Manager SHALL parse PDF and DOCX formats and extract text content for storage
3. THE Context_Manager SHALL persist all context data in the Local_Database and restore it on application restart
4. WHEN the AI_Response_Generator produces an answer, THE Context_Manager SHALL provide all stored session context as input to the AI model
5. IF a resume file exceeds 5 MB or is in an unsupported format, THEN THE Context_Manager SHALL reject the upload with an error indicating the size limit and supported formats (PDF, DOCX)
6. THE Context_Manager SHALL allow users to create, update, and switch between multiple interview sessions

### Requirement 5: Real-Time Audio Capture and Transcription

**User Story:** As a user, I want the app to capture interviewer audio from my meeting tab and transcribe it, so that questions are automatically detected for AI processing.

#### Acceptance Criteria

1. WHEN a user initiates capture, THE Audio_Capture_Engine SHALL request system audio via getDisplayMedia from the selected browser tab
2. WHILE capture is active, THE VAD_Module SHALL monitor audio levels and detect question boundaries using a 1.8-second silence threshold after speech
3. WHEN the VAD_Module detects a complete question (sustained silence after speech), THE Transcription_Service SHALL send the audio segment to the Groq Whisper API using the whisper-large-v3-turbo model
4. IF the user does not check "Share tab audio" during the browser tab selection dialog, THEN THE Audio_Capture_Engine SHALL display an instructional error message explaining how to enable audio sharing
5. WHEN the audio track ends (user stops sharing the tab), THE Audio_Capture_Engine SHALL stop capture and notify the user
6. THE VAD_Module SHALL enforce a 90-second maximum question duration to prevent unbounded audio accumulation
7. THE Filler_Filter SHALL discard audio segments shorter than 12 characters or matching known filler phrases before forwarding to AI processing

### Requirement 6: AI-Powered Answer Generation

**User Story:** As a user, I want context-aware answer suggestions displayed quickly after each question, so that I can reference them during the interview without noticeable delay.

#### Acceptance Criteria

1. WHEN a transcribed question is received, THE AI_Response_Generator SHALL produce an answer suggestion within 3 seconds of transcription completion
2. THE AI_Response_Generator SHALL use the Groq Llama 3.3 70B model (free tier: llama-3.3-70b-versatile) for response generation
3. THE AI_Response_Generator SHALL include the Conversation_Memory (rolling summary of older exchanges plus last 5 Q&A pairs in full) as context for continuity
4. WHEN a new question has 80% or higher word overlap with a previously answered question in the session, THE AI_Response_Generator SHALL return the cached prior response
5. WHEN generating a response, THE AI_Response_Generator SHALL detect the interview type (behavioral, technical, coding, system-design, general) and format the response accordingly
6. THE AI_Response_Generator SHALL output responses as exactly 3 concise bullet points tailored to the detected interview type

### Requirement 7: Coding Interview Mode

**User Story:** As a user, I want the app to detect and solve coding problems from my screen, so that I receive algorithmic guidance during coding interviews.

#### Acceptance Criteria

1. WHEN a user triggers screen analysis, THE Screen_Capture_Module SHALL capture the current video frame from the shared display tab
2. WHEN a frame is captured, THE Screen_Capture_Module SHALL send the image to the Groq vision model for text and problem extraction
3. WHEN a coding problem is identified, THE AI_Response_Generator SHALL produce a response containing: approach explanation, pseudocode or solution, and time/space complexity analysis
4. THE AI_Response_Generator SHALL generate code solutions supporting Python, JavaScript, and TypeScript
5. IF no recognizable coding problem is detected in the captured frame, THEN THE Screen_Capture_Module SHALL inform the user that no problem was found

### Requirement 8: Stealth Overlay Display

**User Story:** As a user, I want a discreet always-on-top overlay hidden from screen sharing, so that I can view AI suggestions without the interviewer seeing them.

#### Acceptance Criteria

1. THE Stealth_Overlay SHALL render as an always-on-top, frameless, transparent window positioned at the right edge of the primary display
2. THE Stealth_Overlay SHALL enable OS-level content protection (setContentProtection) on macOS and Windows to exclude itself from screen capture and screen sharing
3. WHEN a new AI response is generated, THE Stealth_Overlay SHALL display the latest response content automatically
4. THE Application SHALL provide a global hotkey (Cmd/Ctrl+Shift+A) to toggle Stealth_Overlay visibility
5. THE Application SHALL provide a global hotkey (Cmd/Ctrl+Shift+R) to reload the Stealth_Overlay content
6. THE Application SHALL provide a global hotkey (Cmd/Ctrl+Shift+M) to bring the Main_Window to focus
7. THE Stealth_Overlay SHALL be resizable and movable by the user while maintaining always-on-top positioning

### Requirement 9: Desktop Application Stability

**User Story:** As a user, I want a stable and lightweight desktop application, so that it does not interfere with my meeting or system performance.

#### Acceptance Criteria

1. THE Application SHALL enforce single-instance lock to prevent multiple copies from running simultaneously
2. THE Application SHALL bind the Backend exclusively to localhost (127.0.0.1) to prevent external network access
3. THE Application SHALL support macOS 12 or later and Windows 10 or later
4. IF an unhandled exception occurs in the renderer process, THEN THE Application SHALL catch it via React Error Boundary and display a recovery UI without crashing the entire app
5. IF the Groq API is unreachable, THEN THE Application SHALL display a connection error to the user and retry on the next question without terminating the session
6. THE Application SHALL clean up temporary audio files after processing and close audio contexts when capture is stopped

### Requirement 10: Security Hardening

**User Story:** As a user, I want my data and API communications secured, so that my personal information and interview content remain private.

#### Acceptance Criteria

1. THE Backend SHALL enforce rate limiting on all API routes to prevent abuse (maximum 100 requests per minute per user)
2. THE Backend SHALL validate all inputs: file uploads limited to 5 MB, prompt text limited to 10,000 characters
3. THE Backend SHALL restrict CORS to localhost origins only
4. THE Application SHALL validate the Groq API key on startup and display a clear error if the key is missing or invalid
5. THE Application SHALL store all user data exclusively on the local machine with no cloud transmission except Groq API calls
6. WHEN audio transcription is complete, THE Application SHALL delete the temporary audio file from disk

### Requirement 11: Auto-Update via GitHub Releases

**User Story:** As the developer, I want to distribute updates via GitHub Releases with auto-update, so that users receive new versions without a paid distribution platform.

#### Acceptance Criteria

1. THE Application SHALL be packaged as a DMG for macOS and as both a portable EXE and NSIS installer for Windows using electron-builder
2. THE Auto_Updater SHALL check GitHub Releases for new versions on application startup
3. WHEN a new version is available, THE Auto_Updater SHALL notify the user and offer to download and install the update
4. IF the update check fails (no internet or GitHub unreachable), THEN THE Auto_Updater SHALL silently skip the check and allow normal operation
5. THE Application SHALL ship self-signed for macOS with documentation for Gatekeeper bypass, with notarization deferred to post-MVP

### Requirement 12: Groq Free Tier Rate Limit Handling

**User Story:** As a user, I want the app to handle API rate limits gracefully, so that my interview session continues smoothly even when limits are approached.

#### Acceptance Criteria

1. IF the Groq API returns a rate limit error (HTTP 429), THEN THE Backend SHALL queue the request and retry with exponential backoff after the rate-limit reset window
2. WHEN approaching the daily audio transcription limit (28,800 seconds per day), THE Application SHALL warn the user about remaining transcription capacity
3. IF the daily transcription limit is exhausted, THEN THE Application SHALL inform the user that transcription is unavailable until the limit resets and display the reset time
4. IF the chat completion rate limit is hit, THEN THE Backend SHALL queue the response generation and retry, displaying a "generating..." indicator to the user
