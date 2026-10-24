import { Router, type Request, type Response } from "express";
import { authenticate, getAuthenticatedUserId } from '../auth/middleware';
import { subscriptionManager } from "./manager";
import { storage } from '../storage';
import { logger } from '../logging/SafeLogger';
import { toSafeError } from '../logging/SafeError';

const router = Router();

/**
 * POST /api/subscription/checkout
 * Creates a Stripe Checkout session and returns the URL.
 * Requires authentication.
 */
router.post('/checkout', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const user = await storage.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "User not found" },
      });
    }

    const { url } = await subscriptionManager.createCheckoutSession(userId, user.email);

    res.status(200).json({ url });
  } catch (error) {
    logger.error('Subscription checkout failed.', { error: toSafeError(error) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to create checkout session" },
    });
  }
});

/**
 * GET /api/subscription/status
 * Returns the current subscription status.
 * Requires authentication.
 */
router.get('/status', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const status = await subscriptionManager.getStatus(userId);

    res.status(200).json(status);
  } catch (error) {
    logger.error('Subscription status lookup failed.', { error: toSafeError(error) });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to get subscription status" },
    });
  }
});

/**
 * POST /api/webhooks/stripe
 * Stripe webhook endpoint. Uses raw body for signature verification.
 * NOT protected by auth middleware (Stripe calls this directly).
 */
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["stripe-signature"] as string;

    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    const rawBody = req.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ error: 'Missing raw body for webhook verification' });
    }

    await subscriptionManager.handleWebhook(rawBody, signature);

    res.status(200).json({ received: true });
  } catch (error) {
    logger.warn('Stripe webhook processing failed.', { error: toSafeError(error) });
    res.status(400).json({ error: 'Webhook processing failed' });
  }
});

export default router;
