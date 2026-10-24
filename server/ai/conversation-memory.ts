import type { Message } from "@shared/schema";

export interface ConversationMemory {
  rollingSummary: string;
  recentExchanges: { question: string; answer: string }[];
}

/**
 * Build a conversation memory object from message history.
 * - Last 5 messages: full text
 * - Older messages: compressed summary
 */
export function buildConversationMemory(messages: Message[]): ConversationMemory {
  if (messages.length === 0) {
    return { rollingSummary: "", recentExchanges: [] };
  }

  const recentCount = 5;
  const recent = messages.slice(-recentCount);
  const older = messages.slice(0, Math.max(0, messages.length - recentCount));

  // Build rolling summary of older messages
  let rollingSummary = "";
  if (older.length > 0) {
    const summaryParts = older.map((m) => {
      const q = (m.transcription || "").slice(0, 80);
      const a = (m.aiResponse || "").slice(0, 80);
      return `Q: ${q}${m.transcription.length > 80 ? "..." : ""} → A: ${a}${m.aiResponse.length > 80 ? "..." : ""}`;
    });
    rollingSummary = `Previous topics discussed (${older.length} exchanges):\n${summaryParts.join("\n")}`;
  }

  // Build recent exchanges in full
  const recentExchanges = recent.map((m) => ({
    question: m.transcription || "",
    answer: m.aiResponse || "",
  }));

  return { rollingSummary, recentExchanges };
}

/**
 * Format conversation memory into a prompt string for AI context.
 */
export function formatMemoryForPrompt(memory: ConversationMemory): string {
  const parts: string[] = [];

  if (memory.rollingSummary) {
    parts.push(memory.rollingSummary);
  }

  if (memory.recentExchanges.length > 0) {
    const recentText = memory.recentExchanges
      .map((e) => `Q: ${e.question}\nYour previous hint: ${e.answer}`)
      .join("\n\n");
    parts.push(`Recent conversation (last ${memory.recentExchanges.length} exchanges):\n${recentText}`);
  }

  return parts.join("\n\n");
}
