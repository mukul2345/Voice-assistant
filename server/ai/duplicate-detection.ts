import type { Message } from "@shared/schema";

/**
 * Compute word overlap ratio between two strings.
 * Returns a value between 0 and 1.
 * Only considers "significant" words (length > 2).
 */
export function computeWordOverlap(text1: string, text2: string): number {
  const normalize = (t: string) =>
    t.toLowerCase().replace(/\s+/g, " ").trim();

  const words1 = new Set(
    normalize(text1).split(" ").filter((w) => w.length > 2)
  );
  const words2 = new Set(
    normalize(text2).split(" ").filter((w) => w.length > 2)
  );

  if (words1.size < 4 || words2.size < 4) return 0;

  let matchCount = 0;
  const arr1 = Array.from(words1);
  for (const word of arr1) {
    if (words2.has(word)) matchCount++;
  }

  return matchCount / Math.max(words1.size, words2.size);
}

/**
 * Find a cached response for a question if it's a near-duplicate of a previous one.
 * Returns the cached AI response if overlap >= threshold, or null.
 */
export function findCachedResponse(
  question: string,
  messages: Message[],
  threshold = 0.8
): string | null {
  if (!question || question.length < 10) return null;

  const normalized = question.toLowerCase().replace(/\s+/g, " ").trim();

  for (const msg of messages) {
    const msgQ = (msg.transcription || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!msgQ || msgQ.length < 10) continue;

    // Exact match
    if (msgQ === normalized) {
      return msg.aiResponse || null;
    }

    // Word overlap check
    const overlap = computeWordOverlap(question, msg.transcription);
    if (overlap >= threshold) {
      return msg.aiResponse || null;
    }
  }

  return null;
}
