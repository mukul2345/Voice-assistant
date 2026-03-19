/**
 * Interview type detection and specialized prompt generation
 * Detects: Coding, System Design, Behavioral, General Technical
 */

export type InterviewType = "coding" | "system-design" | "behavioral" | "technical" | "general";

/**
 * Detect interview type from transcription and context
 */
export function detectInterviewType(transcription: string, context: string): InterviewType {
  const text = `${transcription} ${context}`.toLowerCase();

  // Coding interview keywords
  const codingKeywords = [
    "algorithm", "leetcode", "hackerrank", "code", "function", "array", "string",
    "tree", "graph", "linked list", "binary", "sort", "search", "dynamic programming",
    "time complexity", "space complexity", "big o", "optimize", "implement",
    "write a function", "solve this", "two sum", "reverse", "palindrome"
  ];

  // System design keywords
  const systemDesignKeywords = [
    "system design", "architecture", "scalability", "load balancer", "database",
    "microservices", "api design", "caching", "cdn", "distributed", "sharding",
    "replication", "consistency", "availability", "partition", "design a system",
    "design twitter", "design uber", "design instagram", "how would you build"
  ];

  // Behavioral keywords
  const behavioralKeywords = [
    "tell me about", "describe a time", "give me an example", "how did you",
    "conflict", "challenge", "difficult", "team", "leadership", "failure",
    "success", "project", "experience", "situation", "star method", "weakness",
    "strength", "why do you", "why should we", "where do you see yourself"
  ];

  // Count matches
  const codingScore = codingKeywords.filter(k => text.includes(k)).length;
  const systemDesignScore = systemDesignKeywords.filter(k => text.includes(k)).length;
  const behavioralScore = behavioralKeywords.filter(k => text.includes(k)).length;

  // Determine type based on highest score
  const maxScore = Math.max(codingScore, systemDesignScore, behavioralScore);
  
  if (maxScore === 0) return "general";
  if (codingScore === maxScore) return "coding";
  if (systemDesignScore === maxScore) return "system-design";
  if (behavioralScore === maxScore) return "behavioral";
  
  return "technical";
}

/**
 * Build specialized prompt based on interview type
 */
export function buildInterviewPrompt(type: InterviewType, sessionContext: string): string {
  const baseContext = sessionContext 
    ? `\n\nSession context: ${sessionContext}` 
    : "";

  switch (type) {
    case "coding":
      return `You are an expert coding interview copilot. Help the candidate solve algorithmic problems.

RULES:
- Output EXACTLY 3 concise bullet points
- Focus on: algorithm approach, time/space complexity, edge cases, optimization hints
- Provide concrete examples and pseudocode snippets when helpful
- Mention relevant data structures and patterns
- If it's a known problem (e.g., Two Sum, LRU Cache), hint at the optimal approach
- Be direct and actionable - the candidate needs quick, clear guidance${baseContext}`;

    case "system-design":
      return `You are an expert system design interview copilot. Help the candidate design scalable systems.

RULES:
- Output EXACTLY 3 concise bullet points
- Focus on: architecture components, scalability strategies, trade-offs, bottlenecks
- Mention specific technologies (Redis, Kafka, PostgreSQL, etc.) when relevant
- Cover: data flow, API design, database schema, caching, load balancing
- Discuss CAP theorem, consistency models, and distributed system concepts
- Be specific about numbers (QPS, storage, latency) when the question mentions scale${baseContext}`;

    case "behavioral":
      return `You are an expert behavioral interview copilot. Help the candidate structure compelling answers.

RULES:
- Output EXACTLY 3 concise bullet points
- Use STAR method: Situation, Task, Action, Result
- Focus on: specific examples, quantifiable results, leadership/teamwork, lessons learned
- Remind about key soft skills: communication, problem-solving, adaptability, ownership
- Suggest relevant past experiences the candidate might draw from
- Keep answers authentic and specific, not generic${baseContext}`;

    case "technical":
      return `You are an expert technical interview copilot. Help with general technical questions.

RULES:
- Output EXACTLY 3 concise bullet points
- Cover: core concepts, best practices, real-world applications, trade-offs
- Provide concrete examples and comparisons
- Mention relevant technologies, frameworks, and patterns
- Balance theory with practical implementation details
- Be clear and direct${baseContext}`;

    case "general":
    default:
      return `You are an expert interview copilot. Provide helpful, concise guidance.

RULES:
- Output EXACTLY 3 concise bullet points
- If it's a question, provide direct answer hints
- If it's small talk or a statement, give brief acknowledgment tips
- Be professional, clear, and actionable
- Adapt to the conversation context${baseContext}`;
  }
}
