## Packages
framer-motion | For smooth list animations and premium UI transitions
date-fns | Formatting timestamps for the message history
clsx | Class name merging (standard)
tailwind-merge | Tailwind class merging (standard)

## Notes
- `documentPictureInPicture` API is heavily used. It's currently supported primarily in Chromium-based browsers. A fallback sidebar is provided if it's unavailable.
- Audio capture relies on `navigator.mediaDevices.getDisplayMedia`. Users MUST explicitly check "Share Audio" in the browser prompt for this to work.
- The app requests chunks every 5 seconds as specified by the requirements, using the stop/start MediaRecorder pattern.
