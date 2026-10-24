/**
 * Screen analysis: vision (OCR/question extraction) + chat (answer).
 * Uses Groq vision when available, else OpenAI.
 */

import type OpenAI from "openai";
import fs from "fs";

const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const OPENAI_VISION_MODEL = "gpt-4o";

export function buildVisionMessage(imagePath: string): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString("base64");
  const mime = "image/jpeg";
  const dataUrl = `data:${mime};base64,${base64}`;

  return [
    {
      type: "text",
      text: "This image is a screenshot from an interview (e.g. shared screen, slide, or document). Extract any question, problem statement, or topic visible as text. If there is no clear question, describe briefly what is shown (e.g. 'Whiteboard diagram', 'Code snippet'). Reply with that text only, no preamble.",
    },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
}

export function buildScreenAnswerPrompt(sessionContext: string): string {
  return [
    "You are an expert technical interview copilot. The user shared a screenshot from their interview (e.g. a question on screen, a slide, shared document).",
    "Provide exactly 3 short, actionable bullet points to help them answer or address what is shown. Be technical and concise.",
    sessionContext ? `Session context: ${sessionContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function getVisionModel(groq: OpenAI | null): string {
  return groq ? GROQ_VISION_MODEL : OPENAI_VISION_MODEL;
}
