import { useState, useRef, useCallback } from "react";
import { useProcessAudio, type ProcessAudioPayload } from "./use-copilot";
import { useToast } from "./use-toast";

type CaptureState = "idle" | "capturing" | "error";

export function useAudioCapture(getContext?: () => string) {
  const [state, setState] = useState<CaptureState>("idle");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const lastAudioTimeRef = useRef<number>(Date.now());
  const silenceCheckIntervalRef = useRef<number | null>(null);
  const hasShownKeyToastRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  // VAD state tracking
  const vadStateRef = useRef({
    isSpeaking: false,
    silenceStart: null as number | null,
    audioBuffer: [] as Blob[],
    silenceThreshold: 1800, // 1.8 seconds of sustained silence
    maxQuestionDuration: 90000, // 90 seconds max
    questionStartTime: null as number | null,
  });

  const processAudioMutation = useProcessAudio();
  const { toast } = useToast();

  // Audio level detection helper for VAD
  const detectAudioLevel = useCallback(async (audioBlob: Blob): Promise<number> => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    } catch (err) {
      console.error("Audio level detection error:", err);
      return 0;
    }
  }, []);

  const processCompleteQuestion = useCallback(async (audioBuffer: Blob[]) => {
    if (audioBuffer.length === 0) return;

    try {
      // Combine all chunks into one blob
      const completeAudio = new Blob(audioBuffer, { type: "audio/webm" });
      
      // Only process if audio is substantial (> 1 second worth)
      if (completeAudio.size < 10000) {
        console.log("Audio too small, skipping:", completeAudio.size);
        return;
      }

      console.log("Processing complete question, audio size:", completeAudio.size);

      const payload: ProcessAudioPayload = {
        blob: completeAudio,
        context: getContext?.() ?? "",
      };

      await processAudioMutation.mutateAsync(payload);
      
      console.log("Question processed successfully, ready for next question");
    } catch (err: any) {
      console.error("Failed to process audio:", err);
      const msg = err?.message || "";
      const isApiKeyError = msg.includes("API key") || msg.includes("503");
      if (isApiKeyError && !hasShownKeyToastRef.current) {
        hasShownKeyToastRef.current = true;
        toast({
          title: "API key required",
          description: "Add GROQ_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY to .env",
          variant: "destructive",
          duration: 15000,
        });
      }
    }
  }, [processAudioMutation, getContext, toast]);

  const detectAudioActivity = useCallback((stream: MediaStream) => {
    try {
      // Create audio context for volume detection
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      // Check audio level every 500ms
      const checkAudio = () => {
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        
        // If volume above threshold (30), consider it as audio activity
        if (average > 30) {
          lastAudioTimeRef.current = Date.now();
          console.log("Audio detected, volume:", Math.round(average));
        }
      };

      // Check audio activity every 500ms
      const intervalId = setInterval(checkAudio, 500);
      
      return () => {
        clearInterval(intervalId);
        source.disconnect();
        audioContext.close();
      };
    } catch (err) {
      console.error("Audio detection error:", err);
      return () => {};
    }
  }, []);

  const stopEverything = useCallback(() => {
    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
      silenceCheckIntervalRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioChunksRef.current = [];
    // Reset VAD state
    vadStateRef.current = {
      isSpeaking: false,
      silenceStart: null,
      audioBuffer: [],
      silenceThreshold: 1800,
      maxQuestionDuration: 90000,
      questionStartTime: null,
    };
    setState("idle");
  }, []);

  const startCapture = useCallback(async () => {
    try {
      setError(null);
      hasShownKeyToastRef.current = false;

      // Check if running in Electron
      const isElectron = !!(window as any).electron;

      if (isElectron) {
        // Electron-specific screen capture using desktopCapturer
        try {
          const sources = await (window as any).electron.getDesktopSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 150, height: 150 }
          });

          if (!sources || sources.length === 0) {
            throw new Error('No screen sources available');
          }

          // Show a simple picker (you can enhance this with a custom UI)
          const sourceNames = sources.map((s: any, i: number) => `${i + 1}. ${s.name}`).join('\n');
          const choice = prompt(`Select screen/window to capture:\n\n${sourceNames}\n\nEnter number (1-${sources.length}):`);
          
          if (!choice) {
            setState("idle");
            return;
          }

          const sourceIndex = parseInt(choice) - 1;
          if (sourceIndex < 0 || sourceIndex >= sources.length) {
            throw new Error('Invalid selection');
          }

          const selectedSource = sources[sourceIndex];

          // Get the stream using the selected source
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource.id
              }
            } as any,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource.id
              }
            } as any
          });

          // Continue with the stream setup
          const audioTrack = stream.getAudioTracks()[0];
          if (!audioTrack) {
            stream.getTracks().forEach(t => t.stop());
            toast({
              title: "No audio track",
              description: "The selected source doesn't have audio. Make sure to select a window/tab with audio.",
              variant: "destructive",
              duration: 12000,
            });
            setState("idle");
            return;
          }

          // Create audio stream
          const audioStream = new MediaStream([audioTrack]);
          streamRef.current = stream;

          // Start audio activity detection
          detectAudioActivity(audioStream);

          // Create recorder that records continuously
          const recorder = new MediaRecorder(audioStream, {
            mimeType: "audio/webm",
          });
          recorderRef.current = recorder;

          // Set up recorder handlers (same as before)
          recorder.ondataavailable = async (e) => {
            if (e.data.size > 0) {
              const now = Date.now();
              
              // Detect audio level for VAD
              const audioLevel = await detectAudioLevel(e.data);
              const SPEECH_THRESHOLD = 0.01;
              
              console.log("Audio chunk received, level:", audioLevel.toFixed(4));
              
              if (audioLevel > SPEECH_THRESHOLD) {
                if (!vadStateRef.current.isSpeaking) {
                  console.log("Speech started");
                  vadStateRef.current.questionStartTime = now;
                }
                vadStateRef.current.isSpeaking = true;
                vadStateRef.current.silenceStart = null;
                vadStateRef.current.audioBuffer.push(e.data);
                
                if (vadStateRef.current.questionStartTime) {
                  const questionDuration = now - vadStateRef.current.questionStartTime;
                  if (questionDuration >= vadStateRef.current.maxQuestionDuration) {
                    console.log("Max question duration (90s) reached, processing...");
                    await processCompleteQuestion(vadStateRef.current.audioBuffer);
                    vadStateRef.current = {
                      ...vadStateRef.current,
                      isSpeaking: false,
                      silenceStart: null,
                      audioBuffer: [],
                      questionStartTime: null,
                    };
                  }
                }
              } else if (vadStateRef.current.isSpeaking) {
                if (!vadStateRef.current.silenceStart) {
                  vadStateRef.current.silenceStart = now;
                  console.log("Silence started after speech");
                }
                
                const silenceDuration = now - vadStateRef.current.silenceStart;
                
                if (silenceDuration >= vadStateRef.current.silenceThreshold) {
                  console.log(`Sustained silence (${silenceDuration}ms) detected, processing complete question...`);
                  await processCompleteQuestion(vadStateRef.current.audioBuffer);
                  vadStateRef.current = {
                    ...vadStateRef.current,
                    isSpeaking: false,
                    silenceStart: null,
                    audioBuffer: [],
                    questionStartTime: null,
                  };
                } else {
                  vadStateRef.current.audioBuffer.push(e.data);
                }
              }
            }
          };

          audioTrack.onended = () => {
            stopEverything();
            toast({
              title: "Capture Stopped",
              description: "Screen capture was ended.",
            });
          };

          recorder.start(1000);
          setState("capturing");
          lastAudioTimeRef.current = Date.now();

          toast({
            title: "Capture Started ✅",
            description: "Listening continuously... Will process after 1.8s of silence",
          });

          console.log("Audio capture started with VAD (Electron mode)");
          return;

        } catch (err: any) {
          console.error("Electron capture error:", err);
          throw err;
        }
      }

      // Browser mode (original code)
      // Pre-flight check 1: Verify microphone permission
      try {
        const permissionStatus = await navigator.permissions.query({ 
          name: 'microphone' as PermissionName 
        });
        if (permissionStatus.state === 'denied') {
          const errorMsg = 'Microphone permission denied. Please grant access in browser settings.';
          setError(errorMsg);
          setState("error");
          toast({
            title: "Microphone Permission Denied",
            description: errorMsg,
            variant: "destructive",
            duration: 10000,
          });
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
          const errorMsg = 'No audio input device detected. Please connect a microphone.';
          setError(errorMsg);
          setState("error");
          toast({
            title: "No Audio Device",
            description: errorMsg,
            variant: "destructive",
            duration: 10000,
          });
          return;
        }
      } catch (err: any) {
        const errorMsg = 'Failed to enumerate audio devices: ' + (err?.message || 'Unknown error');
        setError(errorMsg);
        setState("error");
        toast({
          title: "Device Check Failed",
          description: errorMsg,
          variant: "destructive",
          duration: 10000,
        });
        return;
      }

      // Call getDisplayMedia directly to preserve user gesture context
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true, 
        audio: true 
      });

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        stream.getTracks().forEach(t => t.stop());
        toast({
          title: "No audio — check the box in the picker",
          description: "After choosing your meeting tab, you must check \"Share tab audio\" (or \"Share audio\") at the bottom of the dialog, then click Share. Try Start Capture again.",
          variant: "destructive",
          duration: 12000,
        });
        setState("idle");
        return;
      }

      // Create audio stream
      const audioStream = new MediaStream([audioTrack]);
      streamRef.current = stream;

      // Start audio activity detection
      detectAudioActivity(audioStream);

      // Create recorder that records continuously
      const recorder = new MediaRecorder(audioStream, {
        mimeType: "audio/webm",
      });
      recorderRef.current = recorder;

      // Accumulate audio chunks with VAD-based processing
      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          const now = Date.now();
          
          // Detect audio level for VAD
          const audioLevel = await detectAudioLevel(e.data);
          const SPEECH_THRESHOLD = 0.01; // RMS threshold for speech detection
          
          console.log("Audio chunk received, level:", audioLevel.toFixed(4));
          
          if (audioLevel > SPEECH_THRESHOLD) {
            // Speech detected
            if (!vadStateRef.current.isSpeaking) {
              console.log("Speech started");
              vadStateRef.current.questionStartTime = now;
            }
            vadStateRef.current.isSpeaking = true;
            vadStateRef.current.silenceStart = null;
            vadStateRef.current.audioBuffer.push(e.data);
            
            // Check max question duration safeguard
            if (vadStateRef.current.questionStartTime) {
              const questionDuration = now - vadStateRef.current.questionStartTime;
              if (questionDuration >= vadStateRef.current.maxQuestionDuration) {
                console.log("Max question duration (90s) reached, processing...");
                await processCompleteQuestion(vadStateRef.current.audioBuffer);
                vadStateRef.current = {
                  ...vadStateRef.current,
                  isSpeaking: false,
                  silenceStart: null,
                  audioBuffer: [],
                  questionStartTime: null,
                };
              }
            }
          } else if (vadStateRef.current.isSpeaking) {
            // Silence after speech
            if (!vadStateRef.current.silenceStart) {
              vadStateRef.current.silenceStart = now;
              console.log("Silence started after speech");
            }
            
            const silenceDuration = now - vadStateRef.current.silenceStart;
            
            if (silenceDuration >= vadStateRef.current.silenceThreshold) {
              // Sustained silence detected - process complete question
              console.log(`Sustained silence (${silenceDuration}ms) detected, processing complete question...`);
              await processCompleteQuestion(vadStateRef.current.audioBuffer);
              vadStateRef.current = {
                ...vadStateRef.current,
                isSpeaking: false,
                silenceStart: null,
                audioBuffer: [],
                questionStartTime: null,
              };
            } else {
              // Still within silence threshold, keep buffering
              vadStateRef.current.audioBuffer.push(e.data);
            }
          }
        }
      };

      // Listen for user stopping sharing
      audioTrack.onended = () => {
        stopEverything();
        toast({
          title: "Capture Stopped",
          description: "System audio capture was ended.",
        });
      };

      // Start recording continuously with 1-second chunks
      recorder.start(1000); // Get data every 1 second for VAD analysis
      setState("capturing");
      lastAudioTimeRef.current = Date.now();

      toast({
        title: "Capture Started ✅",
        description: "Listening continuously... Will process after 1.8s of silence",
      });

      console.log("Audio capture started with VAD, listening for questions...");

    } catch (err: any) {
      console.error("Capture error:", err);
      const msg = err?.message || "";
      const isCancel = err?.name === "NotAllowedError" || msg.toLowerCase().includes("cancel");
      setError(isCancel ? "" : msg || "Failed to start capture");
      setState(isCancel ? "idle" : "error");
      if (isCancel) {
        stopEverything();
        return;
      }
      stopEverything();
      toast({
        title: "Capture failed",
        description: msg || "Try choosing Chrome Tab and your meeting tab, then check Share audio.",
        variant: "destructive",
      });
    }
  }, [processAudioMutation, stopEverything, toast, getContext, detectAudioActivity, detectAudioLevel, processCompleteQuestion]);

  const stopCapture = useCallback(() => {
    stopEverything();
  }, [stopEverything]);

  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    const stream = streamRef.current;
    const videoTrack = stream?.getVideoTracks()[0];
    if (!stream || !videoTrack) return null;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([videoTrack]);
    video.width = 1280;
    video.height = 720;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("Video load failed"));
        video.play().catch(reject);
      });
      await new Promise((r) => setTimeout(r, 100));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);
      video.srcObject = null;

      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob ?? null), "image/jpeg", 0.85);
      });
    } finally {
      video.srcObject = null;
    }
  }, []);

  return {
    state,
    error,
    startCapture,
    stopCapture,
    captureFrame,
    isProcessing: processAudioMutation.isPending,
  };
}
