import { useState, useCallback } from "react";

/**
 * Conversation entry representing a single Q&A pair
 */
export interface ConversationEntry {
  question: string;
  answer: string;
  timestamp: number;
}

/**
 * Memory state with full history, recent detail, and rolling summary
 */
export interface MemoryState {
  recentHistory: ConversationEntry[]; // Last 5 Q&A (full detail)
  rolledUpSummary: string; // Compressed older history
  fullHistory: ConversationEntry[]; // Complete session (for lookup)
}

/**
 * Hook for managing session-long conversation memory with rolling summaries.
 * 
 * Fixes Bug 8-9: Memory limitation where only last 5 Q&A pairs were retained.
 * 
 * Features:
 * - Stores full conversation history (all Q&A pairs)
 * - Maintains recent 5 Q&A in full detail
 * - Implements rolling summary for older entries (beyond 5)
 * - Enables consistent answers when questions are repeated
 * 
 * Requirements: 2.8, 3.2, 3.4
 */
export function useConversationMemory() {
  const [memory, setMemory] = useState<MemoryState>({
    recentHistory: [],
    rolledUpSummary: '',
    fullHistory: []
  });

  /**
   * Add a new Q&A entry to the conversation memory
   */
  const addEntry = useCallback(async (question: string, answer: string) => {
    const entry: ConversationEntry = { 
      question, 
      answer, 
      timestamp: Date.now() 
    };
    
    setMemory(prev => {
      const newFullHistory = [...prev.fullHistory, entry];
      const newRecentHistory = [...prev.recentHistory, entry].slice(-5);
      
      // If we have more than 5 entries, roll up the oldest
      let newSummary = prev.rolledUpSummary;
      if (newFullHistory.length > 5) {
        const oldEntries = newFullHistory.slice(0, -5);
        // Call AI to summarize old entries (async, non-blocking)
        summarizeOldEntries(oldEntries).then(summary => {
          setMemory(m => ({ ...m, rolledUpSummary: summary }));
        }).catch(err => {
          console.error("Failed to generate rolling summary:", err);
        });
      }
      
      return {
        recentHistory: newRecentHistory,
        rolledUpSummary: newSummary,
        fullHistory: newFullHistory
      };
    });
  }, []);

  /**
   * Get context for AI prompt (summary + recent Q&A)
   */
  const getContextForPrompt = useCallback(() => {
    return {
      summary: memory.rolledUpSummary,
      recentQA: memory.recentHistory
    };
  }, [memory]);

  /**
   * Search full history for a previous answer to a similar question
   */
  const findPreviousAnswer = useCallback((question: string): string | null => {
    // Search full history for similar question
    const normalized = question.toLowerCase().trim();
    
    // Try exact match first
    let match = memory.fullHistory.find(entry => 
      entry.question.toLowerCase().trim() === normalized
    );
    
    // If no exact match, try partial match (question contains or is contained)
    if (!match) {
      match = memory.fullHistory.find(entry => {
        const entryQ = entry.question.toLowerCase().trim();
        return entryQ.includes(normalized) || normalized.includes(entryQ);
      });
    }
    
    return match?.answer || null;
  }, [memory.fullHistory]);

  return { 
    addEntry, 
    getContextForPrompt, 
    findPreviousAnswer,
    memory // Expose for testing/debugging
  };
}

/**
 * Generate a rolling summary of old conversation entries using AI
 */
async function summarizeOldEntries(entries: ConversationEntry[]): Promise<string> {
  if (entries.length === 0) return '';
  
  try {
    // Build a concise summary prompt
    const conversationText = entries
      .map(e => `Q: ${e.question}\nA: ${e.answer}`)
      .join('\n\n');
    
    const prompt = `Summarize the following interview Q&A history concisely, preserving key technical details and decisions:

${conversationText}

Provide a brief summary (2-3 sentences) capturing the main topics discussed.`;

    // Call the backend summarization endpoint (we'll need to add this)
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    
    if (!response.ok) {
      console.warn('Summarization API failed, using fallback');
      return generateFallbackSummary(entries);
    }
    
    const { summary } = await response.json();
    return summary || generateFallbackSummary(entries);
  } catch (err) {
    console.error('Error generating summary:', err);
    return generateFallbackSummary(entries);
  }
}

/**
 * Fallback summary generation (simple concatenation of topics)
 */
function generateFallbackSummary(entries: ConversationEntry[]): string {
  if (entries.length === 0) return '';
  
  // Extract first few words from each question as topics
  const topics = entries
    .map(e => e.question.split(' ').slice(0, 5).join(' '))
    .slice(0, 3); // Only first 3 topics
  
  return `Earlier discussion covered: ${topics.join(', ')}...`;
}
