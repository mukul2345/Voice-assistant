/**
 * Filler Filter — detects non-substantive transcriptions that should be discarded.
 * Returns true if the text is filler/noise (should be skipped).
 */

const FILLER_PHRASES = [
  "thank you", "thanks", "thankyou", "you're welcome", "youre welcome",
  "okay", "ok", "uh", "um", "uh huh", "mm", "hmm", "silence", "no speech",
  "no sound", "...", "—", "–", "", "yeah", "yes", "no", "right", "sure",
  "got it", "i see", "interesting", "great", "good", "perfect",
];

/**
 * Check if transcribed text is filler/noise that should not be processed.
 * @param text - The transcribed text
 * @returns true if filler (skip), false if substantive (process)
 */
export function isFillerText(text: string): boolean {
  if (!text) return true;

  // Too short to be a real question (less than 12 characters)
  if (text.length < 12) return true;

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  // Empty after normalization
  if (!normalized) return true;

  // Matches a known filler phrase
  return FILLER_PHRASES.some(
    (phrase) => phrase && (normalized === phrase || normalized === phrase.trim())
  );
}

/**
 * Check if the new transcription is a duplicate of the last one.
 */
export function isDuplicateOfLast(newText: string, lastText: string): boolean {
  if (!newText || !lastText) return false;

  const normalizeText = (t: string) =>
    t.toLowerCase().replace(/\s+/g, " ").trim();

  return normalizeText(newText) === normalizeText(lastText);
}
