import { Router, type Request, type Response } from "express";
import multer from "multer";
import { authenticate, getAuthenticatedUserId } from '../auth/middleware';
import { contextManager, ContextError } from './manager';
import { logger } from '../logging/SafeLogger';
import { toSafeError } from '../logging/SafeError';

const router = Router();

// File upload config (memory storage for parsing, 5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/sessions
 * Create a new interview session.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { companyName, jobDescription, resumeText, skills, notes } = req.body;

    const session = await contextManager.createSession(userId, {
      companyName,
      jobDescription,
      resumeText,
      skills,
      notes,
    });

    res.status(201).json(session);
  } catch (error) {
    logger.error('Session creation failed.', { error: toSafeError(error) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to create session" },
    });
  }
});

/**
 * GET /api/sessions
 * List all sessions for the authenticated user.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const sessions = await contextManager.listSessions(userId);
    res.status(200).json(sessions);
  } catch (error) {
    logger.error('Session listing failed.', { error: toSafeError(error) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to list sessions" },
    });
  }
});

/**
 * GET /api/sessions/:id
 * Get a specific session.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const sessionId = parseInt(String(req.params.id), 10);

    if (isNaN(sessionId)) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid session ID" },
      });
    }

    const session = await contextManager.getSession(sessionId, userId);
    if (!session) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Session not found" },
      });
    }

    res.status(200).json(session);
  } catch (error) {
    logger.error('Session lookup failed.', { error: toSafeError(error) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to get session" },
    });
  }
});

/**
 * PUT /api/sessions/:id
 * Update a session.
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const sessionId = parseInt(String(req.params.id), 10);

    if (isNaN(sessionId)) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid session ID" },
      });
    }

    const { companyName, jobDescription, resumeText, skills, notes } = req.body;

    const session = await contextManager.updateSession(sessionId, userId, {
      companyName,
      jobDescription,
      resumeText,
      skills,
      notes,
    });

    if (!session) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Session not found" },
      });
    }

    res.status(200).json(session);
  } catch (error) {
    logger.error('Session update failed.', { error: toSafeError(error) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to update session" },
    });
  }
});

/**
 * POST /api/sessions/:id/resume
 * Upload a resume file (PDF, DOCX, TXT) and extract text into the session.
 */
router.post('/:id/resume', upload.single('resume'), async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const sessionId = parseInt(String(req.params.id), 10);

    if (isNaN(sessionId)) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid session ID" },
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "No file uploaded" },
      });
    }

    // Parse the resume
    const resumeText = await contextManager.parseResume(
      req.file.buffer,
      req.file.mimetype,
      req.file.size
    );

    // Update session with parsed resume text
    const session = await contextManager.updateSession(sessionId, userId, { resumeText });

    if (!session) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Session not found" },
      });
    }

    res.status(200).json({
      session,
      resumeLength: resumeText.length,
      message: "Resume parsed and saved successfully",
    });
  } catch (error) {
    if (error instanceof ContextError) {
      const status = error.code === 'FILE_TOO_LARGE' ? 413 : 400;
      return res.status(status).json({
        error: { code: error.code, message: error.message },
      });
    }
    logger.error('Resume upload failed.', { error: toSafeError(error) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to process resume" },
    });
  }
});

export default router;
