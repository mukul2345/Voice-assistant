import { Router, type Request, type Response } from "express";
import { authService, AuthError } from "./service";
import { authenticate } from './middleware';
import { logger } from '../logging/SafeLogger';
import { toSafeError } from '../logging/SafeError';

const router = Router();

/**
 * POST /api/auth/register
 * Body: { email, password }
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Email and password are required" },
      });
    }

    const result = await authService.register(email, password);

    res.status(201).json({
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "DUPLICATE_EMAIL" ? 409 : 400;
      return res.status(status).json({
        error: { code: err.code, message: err.message },
      });
    }
    logger.error('User registration failed.', { error: toSafeError(err) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Email and password are required" },
      });
    }

    const result = await authService.login(email, password);

    res.status(200).json({
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({
        error: { code: err.code, message: err.message },
      });
    }
    logger.error('User login failed.', { error: toSafeError(err) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
  }
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 */
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Refresh token is required" },
      });
    }

    const result = await authService.refresh(refreshToken);

    res.status(200).json({ accessToken: result.accessToken });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({
        error: { code: err.code, message: err.message },
      });
    }
    logger.error('Access token refresh failed.', { error: toSafeError(err) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
  }
});

/**
 * POST /api/auth/logout
 * Body: { refreshToken }
 * Requires authentication.
 */
router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.user?.userId;
    if (userId === undefined) {
      return res.status(401).json({
        error: { code: 'TOKEN_MISSING', message: 'Authentication required' },
      });
    }

    if (!refreshToken) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Refresh token is required" },
      });
    }

    await authService.logout(userId, refreshToken);

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('User logout failed.', { error: toSafeError(err) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
  }
});

/**
 * GET /api/auth/me
 * Returns current user info. Requires authentication.
 */
router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (userId === undefined) {
      return res.status(401).json({
        error: { code: 'TOKEN_MISSING', message: 'Authentication required' },
      });
    }
    const { storage } = await import('../storage');
    const user = await storage.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "User not found" },
      });
    }

    res.status(200).json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    logger.error('Authenticated user lookup failed.', { error: toSafeError(err) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
  }
});

export default router;
