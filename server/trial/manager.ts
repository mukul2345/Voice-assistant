import { storage } from "../storage";

export interface AccessResult {
  allowed: boolean;
  reason?: "trial_active" | "subscribed" | "grace_period";
  denyReason?: "trial_expired" | "subscription_inactive";
  remainingSeconds?: number;
}

/**
 * Trial Manager — enforces the 1-hour free trial server-side.
 * Access is granted if ANY of:
 *   1. User has trial time remaining (used < total)
 *   2. User has an active subscription
 *   3. User is within the 3-day grace period after subscription lapse
 */
export class TrialManager {
  /**
   * Check if a user is allowed to process audio.
   */
  async checkAccess(userId: number): Promise<AccessResult> {
    // 1. Check subscription first (active sub bypasses trial entirely)
    const subscription = await storage.getSubscription(userId);

    if (subscription && subscription.status === "active") {
      return { allowed: true, reason: "subscribed" };
    }

    // 2. Check grace period
    if (subscription && subscription.gracePeriodEnd) {
      const graceEnd = new Date(subscription.gracePeriodEnd);
      if (graceEnd > new Date()) {
        return { allowed: true, reason: "grace_period" };
      }
    }

    // 3. Check trial usage
    const trial = await storage.getTrialUsage(userId);

    if (!trial) {
      // No trial record — this shouldn't happen (created on registration)
      // Create one as a safety net
      await storage.createTrialUsage(userId);
      return { allowed: true, reason: "trial_active", remainingSeconds: 3600 };
    }

    const used = trial.usedSeconds ?? 0;
    const total = trial.totalAllowedSeconds ?? 3600;
    const remaining = total - used;

    if (remaining > 0) {
      return { allowed: true, reason: "trial_active", remainingSeconds: remaining };
    }

    // Trial exhausted, no active subscription
    return {
      allowed: false,
      denyReason: "trial_expired",
      remainingSeconds: 0,
    };
  }

  /**
   * Record audio processing usage (in seconds).
   * Called after successful transcription + AI response.
   */
  async recordUsage(userId: number, durationSeconds: number): Promise<void> {
    if (durationSeconds <= 0) return;

    // Don't record usage for subscribed users
    const subscription = await storage.getSubscription(userId);
    if (subscription && subscription.status === "active") {
      return; // Subscribed users don't consume trial time
    }

    await storage.incrementTrialUsage(userId, durationSeconds);
  }

  /**
   * Get remaining trial time in seconds.
   */
  async getRemainingTime(userId: number): Promise<number> {
    const trial = await storage.getTrialUsage(userId);
    if (!trial) return 3600;
    const used = trial.usedSeconds ?? 0;
    const total = trial.totalAllowedSeconds ?? 3600;
    return Math.max(0, total - used);
  }
}

export const trialManager = new TrialManager();
