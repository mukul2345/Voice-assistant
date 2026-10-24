import type { Express, Request } from 'express';
import type { Server } from 'http';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

import multer from 'multer';
import OpenAI from 'openai';

import { api } from '@shared/routes';

import { authenticate } from './auth/middleware';
import authRoutes from './auth/routes';
import { getServerConfig } from './config/env';
import { contextManager } from './context/manager';
import contextRoutes from './context/routes';
import { logger } from './logging/SafeLogger';
import { toSafeError } from './logging/SafeError';
import {
  buildInterviewPrompt,
  detectInterviewType,
} from './services/interview-types';
import {
  buildScreenAnswerPrompt,
  buildVisionMessage,
  getVisionModel,
} from './services/vision';
import { storage } from './storage';
import subscriptionRoutes from './subscription/routes';
import { trialManager } from './trial/manager';

const config = getServerConfig();
const uploadsDir = config.uploadsDirectory;

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

const groq = config.groqApiKey
  ? new OpenAI({
      apiKey: config.groqApiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  : null;
const openai =
  !groq && config.openAiApiKey
    ? new OpenAI({
        apiKey: config.openAiApiKey,
        baseURL: config.openAiBaseUrl,
      })
    : null;

if (!groq && !openai) {
  logger.warn('AI provider is not configured; AI endpoints will be unavailable.');
}

function getAuthenticatedUserId(request: Request): number | undefined {
  return request.user?.userId;
}

function parseOptionalSessionId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const sessionId = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(sessionId) && sessionId > 0 ? sessionId : undefined;
}

async function removeUpload(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    logger.warn('Temporary upload cleanup failed.', { error: toSafeError(error) });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Auth Routes (public) ──────────────────────────────────────────────────
  app.use("/api/auth", authRoutes);

  // ─── Subscription Routes ───────────────────────────────────────────────────
  app.use("/api/subscription", subscriptionRoutes);
  // Webhook needs its own path (outside /api/subscription for clarity)
  app.post("/api/webhooks/stripe", subscriptionRoutes);

  // ─── Context/Sessions Routes ───────────────────────────────────────────────
  app.use("/api/sessions", contextRoutes);

  // ─── Trial Status Route ────────────────────────────────────────────────────
  app.get('/api/trial/status', authenticate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    if (userId === undefined) {
      return res.status(401).json({ error: { code: 'TOKEN_MISSING', message: 'Authentication required' } });
    }
    const [access, remainingSeconds] = await Promise.all([
      trialManager.checkAccess(userId),
      trialManager.getRemainingTime(userId),
    ]);
    return res.status(200).json({
      remainingSeconds,
      isTrialActive: access.reason === 'trial_active',
      isSubscribed: access.reason === 'subscribed',
      isGracePeriod: access.reason === 'grace_period',
      allowed: access.allowed,
    });
  });

  app.get(api.messages.list.path, authenticate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    if (userId === undefined) {
      return res.status(401).json({ error: { code: 'TOKEN_MISSING', message: 'Authentication required' } });
    }
    const requestedSessionId = req.query.sessionId;
    const sessionId = parseOptionalSessionId(requestedSessionId);
    if (requestedSessionId !== undefined && sessionId === undefined) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid session ID' } });
    }
    if (sessionId !== undefined && !(await storage.getSessionForUser(sessionId, userId))) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }
    const userMessages = await storage.getMessages(userId, sessionId);
    return res.json(userMessages);
  });

  app.post(api.messages.clear.path, authenticate, async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    if (userId === undefined) {
      return res.status(401).json({ error: { code: 'TOKEN_MISSING', message: 'Authentication required' } });
    }
    await storage.clearMessages(userId);
    return res.json({ success: true });
  });

  // Summarization endpoint for rolling memory summaries
  app.post('/api/summarize', authenticate, async (req, res) => {
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
    } catch (error) {
      logger.error('Conversation summary generation failed.', { error: toSafeError(error) });
      res.status(500).json({ message: 'Internal error' });
    }
  });

  app.post(api.audio.process.path, authenticate, uploadAudio.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

      const userId = getAuthenticatedUserId(req);
      if (userId === undefined) {
        await removeUpload(req.file.path);
        return res.status(401).json({ error: { code: 'TOKEN_MISSING', message: 'Authentication required' } });
      }

      const requestedSessionId = req.body?.sessionId;
      const sessionId = parseOptionalSessionId(requestedSessionId);
      if (requestedSessionId !== undefined && requestedSessionId !== '' && sessionId === undefined) {
        await removeUpload(req.file.path);
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid session ID' } });
      }

      let sessionContext = typeof req.body?.context === 'string' ? req.body.context.trim() : '';
      if (sessionId !== undefined) {
        const session = await contextManager.getSession(sessionId, userId);
        if (!session) {
          await removeUpload(req.file.path);
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        }
        sessionContext = contextManager.buildContextString(session);
      }

      const access = await trialManager.checkAccess(userId);
      if (!access.allowed) {
        await removeUpload(req.file.path);
        return res.status(403).json({
          error: {
            code: 'TRIAL_EXPIRED',
            message: 'Free trial ended. Subscribe to continue.',
            remainingSeconds: 0,
          },
        });
      }

      const client = groq ?? openai;
      if (!client) {
        await removeUpload(req.file.path);
        return res.status(503).json({ message: 'AI provider is not configured.' });
      }

      const filePath = req.file.path;
      const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: groq ? 'whisper-large-v3-turbo' : 'gpt-4o-mini-transcribe',
      });
      const transcribedText = (transcription.text || '').trim();
      const allMessages = await storage.getMessages(userId, sessionId);
      
      // Check for duplicate/similar question in full history (Bug 8-9 fix)
      const normalizedQuestion = transcribedText.toLowerCase().replace(/\s+/g, " ").trim();
      const previousAnswer = allMessages.find(msg => {
        const msgQ = (msg.transcription || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!msgQ || msgQ.length < 10 || normalizedQuestion.length < 10) return false;
        
        // Exact match
        if (msgQ === normalizedQuestion) return true;
        
        // High-similarity match: require at least 80% word overlap for both directions
        const questionWords = new Set(normalizedQuestion.split(" ").filter(w => w.length > 2));
        const msgWords = new Set(msgQ.split(" ").filter(w => w.length > 2));
        
        if (questionWords.size < 4 || msgWords.size < 4) return false;
        
        let matchCount = 0;
        const questionWordsArr = Array.from(questionWords);
        for (const word of questionWordsArr) {
          if (msgWords.has(word)) matchCount++;
        }
        
        const overlapRatio = matchCount / Math.max(questionWords.size, msgWords.size);
        return overlapRatio >= 0.8;
      });
      
      // If we found a previous answer to the same/similar question, return it
      if (previousAnswer?.aiResponse) {
        logger.info('Reused a scoped answer for a similar question.', { userId, sessionId });
        const message = await storage.createMessage(userId, {
          sessionId,
          transcription: transcribedText,
          aiResponse: previousAnswer.aiResponse,
        });
        await removeUpload(req.file.path);

        return res.status(200).json({
          transcription: message.transcription,
          aiResponse: message.aiResponse,
          skipped: false,
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
      const lastTranscription = allMessages[allMessages.length - 1]?.transcription?.trim() ?? '';
      const isDuplicate = lastTranscription.length > 0 && normalized === lastTranscription.toLowerCase().replace(/\s+/g, " ").trim();

      if (isFiller || isDuplicate) {
        await removeUpload(req.file.path);
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

      const message = await storage.createMessage(userId, {
        sessionId,
        transcription: transcribedText,
        aiResponse,
      });

      const estimatedDuration = Math.max(5, Math.round((req.file.size ?? 10000) / 1000));
      await trialManager.recordUsage(userId, estimatedDuration);
      await removeUpload(req.file.path);

      res.status(200).json({
        transcription: message.transcription,
        aiResponse: message.aiResponse,
        skipped: false,
      });
    } catch (error) {
      logger.error('Audio processing failed.', { error: toSafeError(error) });
      await removeUpload(req.file?.path);
      res.status(500).json({ message: 'Internal error' });
    }
  });

  app.post(api.screen.analyze.path, authenticate, uploadImage.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image provided' });
      }

      const userId = getAuthenticatedUserId(req);
      if (userId === undefined) {
        await removeUpload(req.file.path);
        return res.status(401).json({ error: { code: 'TOKEN_MISSING', message: 'Authentication required' } });
      }

      const requestedSessionId = req.body?.sessionId;
      const sessionId = parseOptionalSessionId(requestedSessionId);
      if (requestedSessionId !== undefined && requestedSessionId !== '' && sessionId === undefined) {
        await removeUpload(req.file.path);
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid session ID' } });
      }

      let sessionContext = typeof req.body?.context === 'string' ? req.body.context.trim() : '';
      if (sessionId !== undefined) {
        const session = await contextManager.getSession(sessionId, userId);
        if (!session) {
          await removeUpload(req.file.path);
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        }
        sessionContext = contextManager.buildContextString(session);
      }

      const access = await trialManager.checkAccess(userId);
      if (!access.allowed) {
        await removeUpload(req.file.path);
        return res.status(403).json({ error: { code: 'TRIAL_EXPIRED', message: 'Free trial ended. Subscribe to continue.' } });
      }

      const client = groq ?? openai;
      if (!client) {
        await removeUpload(req.file.path);
        return res.status(503).json({ message: 'AI provider is not configured.' });
      }

      const imagePath = req.file.path;
      const visionCompletion = await client.chat.completions.create({
        model: getVisionModel(groq),
        messages: [{ role: 'user', content: buildVisionMessage(imagePath) }],
        max_tokens: 500,
      });
      const extractedText = (visionCompletion.choices[0]?.message?.content ?? '').trim() || 'Content on screen';
      const chatCompletion = await client.chat.completions.create({
        model: groq ? 'llama-3.3-70b-versatile' : 'gpt-4o',
        messages: [
          { role: 'system', content: buildScreenAnswerPrompt(sessionContext) },
          { role: 'user', content: `[Screen content]\n${extractedText}` },
        ],
      });
      const aiResponse = chatCompletion.choices[0]?.message?.content ?? 'No response';
      const message = await storage.createMessage(userId, {
        sessionId,
        transcription: `[Screen] ${extractedText.slice(0, 200)}${extractedText.length > 200 ? '…' : ''}`,
        aiResponse,
      });

      await removeUpload(imagePath);
      return res.status(200).json({
        transcription: message.transcription,
        aiResponse: message.aiResponse,
      });
    } catch (error) {
      logger.error('Screen analysis failed.', { error: toSafeError(error) });
      await removeUpload(req.file?.path);
      return res.status(500).json({ message: 'Internal error' });
    }
  });

  return httpServer;
}
