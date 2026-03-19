/**
 * Silence Detection Hook
 * Detects when interviewer stops speaking (silence for 2+ seconds)
 * Captures complete questions instead of fixed time chunks
 */

import { useRef, useCallback } from "react";

interface SilenceDetectionOptions {
  silenceThreshold: number; // dB level below which is considered silence
  silenceDuration: number; // milliseconds of silence to trigger
  onSilenceDetected: () => void; // Callback when silence detected
}

export function useSilenceDetection(options: SilenceDetectionOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const startSilenceDetection = useCallback((stream: MediaStream) => {
    try {
      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Create analyser
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      // Create data array
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      dataArrayRef.current = dataArray;

      // Connect stream to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Start detection loop
      const detectSilence = () => {
        analyser.getByteFrequencyData(dataArray);

        // Calculate average frequency (simple volume detection)
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

        // Check if below silence threshold
        if (average < options.silenceThreshold) {
          // Silence detected
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now();
          }

          // Check if silence duration exceeded
          const silenceDuration = Date.now() - silenceStartRef.current;
          if (silenceDuration > options.silenceDuration) {
            // Trigger callback
            options.onSilenceDetected();
            silenceStartRef.current = null;
          }
        } else {
          // Sound detected, reset silence timer
          silenceStartRef.current = null;
        }

        animationFrameRef.current = requestAnimationFrame(detectSilence);
      };

      detectSilence();
    } catch (err) {
      console.error("Silence detection error:", err);
    }
  }, [options]);

  const stopSilenceDetection = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  }, []);

  return {
    startSilenceDetection,
    stopSilenceDetection,
  };
}
