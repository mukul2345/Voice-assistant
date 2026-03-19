import type { Express } from "express";
import type { Server } from "http";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import multer from "multer";
import OpenAI from "openai";
import { storage } from "./storage";
import { api } from "@shared/routes";
import {
  buildVisionMessage,
  buildScreenAnswerPrompt,
  getVisionModel,
} from "./services/vision";
import {
  detectInterviewType,
  buildInterviewPrompt,
  type InterviewType,
} from "./services/interview-types";

const uploadsDir = "uploads/";

const uploadAudio = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".webm";
      cb(null, `audio-${Date.now()}${ext}`);
    },
  }),
});

const uploadImage = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, _file, cb) => {
      cb(null, `screen-${Date.now()}.jpg`);
    },
  }),
});

// Prefer Groq for both transcription (Whisper) and chat when GROQ_API_KEY is set (free tier available).
const groqApiKey = process.env.GROQ_API_KEY;
const groq = groqApiKey
  ? new OpenAI({
      apiKey: groqApiKey,
      baseURL: "https://api.groq.com/openai/v1",
    })
  : null;

// OpenAI: fallback when Groq not set (transcription + chat)
const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const openai =
  !groq && openaiKey && openaiKey !== "dummy"
    ? new OpenAI({
        apiKey: openaiKey,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      })
    : null;

if (!groq && !openai) {
  console.warn(
    "[Voice Assistant] No API key set. Add GROQ_API_KEY (free at console.groq.com) or AI_INTEGRATIONS_OPENAI_API_KEY to .env and restart."
  );
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get(api.messages.list.path, async (req, res) => {
    const msgs = await storage.getMessages();
    res.json(msgs);
  });

  app.post(api.messages.clear.path, async (req, res) => {
    await storage.clearMessages();
    res.json({ success: true });
  });

  // Summarization endpoint for rolling memory summaries
  app.post("/api/summarize", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ message: "Prompt is required" });
      }

      const client = groq ?? openai;
      if (!client) {
        return res.status(503).json({
          message: "No API key set. Add GROQ_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY to .env.",
        });
      }

      const chatModel = groq ? "llama-3.3-70b-versatile" : "gpt-4o";
      const chatCompletion = await client.chat.completions.create({
        model: chatModel,
        messages: [
          { role: "system", content: "You are a helpful assistant that creates concise summaries of interview conversations." },
          { role: "user", content: prompt }
        ],
        max_tokens: 200, // Keep summaries brief
      });

      const summary = chatCompletion.choices[0]?.message.content || "";

      res.status(200).json({ summary });
    } catch (err: any) {
      console.error("Error generating summary:", err);
      res.status(500).json({ message: err.message || "Internal error" });
    }
  });

  app.post(api.audio.process.path, uploadAudio.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

      const client = groq ?? openai;
      if (!client) {
        return res.status(503).json({
          message: "No API key set. Add GROQ_API_KEY (free at console.groq.com) or AI_INTEGRATIONS_OPENAI_API_KEY to .env and restart.",
        });
      }

      // 1. Transcribe: Groq Whisper or OpenAI (saved file has .webm so Groq accepts it)
      const filePath = req.file.path;
      const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath) as any,
        model: groq ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe",
      });
      const transcribedText = (transcription.text || "").trim();

      // Session context (e.g. "Technical interview - Backend Engineer") from form
      const sessionContext = (req.body?.context ?? "").trim();

      // Get recent conversation history for context continuity
      // Session-long memory: Keep ALL messages for duplicate detection
      // Use rolling summary for older messages (beyond last 5)
      const allMessages = await storage.getMessages();
      
      // Check for duplicate/similar question in full history (Bug 8-9 fix)
      const normalizedQuestion = transcribedText.toLowerCase().replace(/\s+/g, " ").trim();
      const previousAnswer = allMessages.find(msg => {
        const msgQ = (msg.transcription || "").toLowerCase().replace(/\s+/g, " ").trim();
        // Exact match or substantial overlap
        return msgQ === normalizedQuestion || 
               (msgQ.length > 20 && normalizedQuestion.length > 20 && 
                (msgQ.includes(normalizedQuestion) || normalizedQuestion.includes(msgQ)));
      });
      
      // If we found a previous answer to the same/similar question, return it
      if (previousAnswer && previousAnswer.aiResponse) {
        console.log("Found previous answer for similar question, returning cached response");
        
        // Still save this as a new message for the feed
        const msg = await storage.createMessage({
          transcription: transcribedText,
          aiResponse: previousAnswer.aiResponse,
        });
        
        await fsPromises.unlink(req.file.path).catch(console.error);
        
        return res.status(200).json({
          transcription: msg.transcription,
          aiResponse: msg.aiResponse,
          skipped: false,
          cached: true,
        });
      }
      
      // Build context with rolling summary approach
      // Recent 5 messages: full detail
      // Older messages: summarized
      const recentMessages = allMessages.slice(-5);
      const olderMessages = allMessages.slice(0, -5);
      
      let conversationHistory = "";
      
      // Add rolling summary of older messages if they exist
      if (olderMessages.length > 0) {
        const summaryText = olderMessages
          .map(m => `Q: ${m.transcription?.slice(0, 50)}... A: ${m.aiResponse?.slice(0, 50)}...`)
          .join('; ');
        conversationHistory += `Earlier discussion summary: ${summaryText}\n\n`;
      }
      
      // Add recent 5 messages in full detail
      conversationHistory += recentMessages
        .map(m => `Q: ${m.transcription}\nYour hint: ${m.aiResponse}`)
        .join('\n\n');

      // 2. Skip filler / silence / duplicate so we don't spam "thank you" or repeat
      const FILLER_PHRASES = [
        "thank you", "thanks", "thankyou", "you're welcome", "youre welcome",
        "okay", "ok", "uh", "um", "uh huh", "mm", "hmm", "silence", "no speech",
        "no sound", "...", "—", "–", ""
      ];
      const normalized = transcribedText.toLowerCase().replace(/\s+/g, " ").trim();
      const isFiller =
        transcribedText.length < 12 ||
        FILLER_PHRASES.some((p) => p && (normalized === p || normalized === p.trim()));
      const lastMessages = await storage.getMessages();
      const lastTranscription = lastMessages[lastMessages.length - 1]?.transcription?.trim() ?? "";
      const isDuplicate = lastTranscription.length > 0 && normalized === lastTranscription.toLowerCase().replace(/\s+/g, " ").trim();

      if (isFiller || isDuplicate) {
        await fsPromises.unlink(req.file.path).catch(console.error);
        return res.status(200).json({
          transcription: transcribedText,
          aiResponse: "",
          skipped: true,
        });
      }

      // 3. Chat: Smart interview response based on type detection
      const chatModel = groq ? "llama-3.3-70b-versatile" : "gpt-4o";
      
      // Detect interview type from transcription and context
      const interviewType = detectInterviewType(transcribedText, sessionContext);
      const systemPrompt = buildInterviewPrompt(interviewType, sessionContext);

      // Add conversation history for continuity
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt }
      ];

      // Add recent conversation for context
      if (conversationHistory) {
        messages.push({
          role: "system",
          content: `Recent conversation context (for continuity):\n${conversationHistory}`
        });
      }

      // Current question
      messages.push({ role: "user", content: transcribedText });

      const chatCompletion = await client.chat.completions.create({
        model: chatModel,
        messages,
      });

      const aiResponse = chatCompletion.choices[0]?.message.content || "No response";

      // 4. Save to storage
      const msg = await storage.createMessage({
        transcription: transcribedText,
        aiResponse,
      });

      // Cleanup temp file
      await fsPromises.unlink(req.file.path).catch(console.error);

      res.status(200).json({
        transcription: msg.transcription,
        aiResponse: msg.aiResponse,
        skipped: false,
      });

    } catch (err: any) {
      console.error("Error processing audio:", err);
      if (req.file) await fsPromises.unlink(req.file.path).catch(console.error);
      res.status(500).json({ message: err.message || "Internal error" });
    }
  });

  // Screen analysis: capture frame → vision (extract question) → chat (answer). Works for any meeting app (Meet, Teams, Zoom).
  app.post(api.screen.analyze.path, uploadImage.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image provided" });
      }

      const client = groq ?? openai;
      if (!client) {
        return res.status(503).json({
          message: "No API key set. Add GROQ_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY to .env.",
        });
      }

      const sessionContext = (req.body?.context ?? "").trim();
      const imagePath = req.file.path;

      // 1. Vision: extract question/text from screenshot (Groq vision or OpenAI gpt-4o)
      const visionModel = getVisionModel(groq);
      const visionContent = buildVisionMessage(imagePath);
      const visionCompletion = await client.chat.completions.create({
        model: visionModel,
        messages: [{ role: "user", content: visionContent }],
        max_tokens: 500,
      });
      const extractedText = (visionCompletion.choices[0]?.message?.content ?? "").trim() || "Content on screen";

      // 2. Chat: 3 bullet-point answer hints (same as audio flow)
      const chatModel = groq ? "llama-3.3-70b-versatile" : "gpt-4o";
      const systemPrompt = buildScreenAnswerPrompt(sessionContext);
      const chatCompletion = await client.chat.completions.create({
        model: chatModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `[Screen content]\n${extractedText}` },
        ],
      });
      const aiResponse = chatCompletion.choices[0]?.message?.content ?? "No response";

      // 3. Save as message so it appears in feed and stealth
      const msg = await storage.createMessage({
        transcription: `[Screen] ${extractedText.slice(0, 200)}${extractedText.length > 200 ? "…" : ""}`,
        aiResponse,
      });

      await fsPromises.unlink(imagePath).catch(console.error);

      res.status(200).json({
        transcription: msg.transcription,
        aiResponse: msg.aiResponse,
      });
    } catch (err: any) {
      console.error("Error analyzing screen:", err);
      if (req.file) await fsPromises.unlink(req.file.path).catch(console.error);
      res.status(500).json({ message: err.message || "Internal error" });
    }
  });

  return httpServer;
}
