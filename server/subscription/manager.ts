import Stripe from "stripe";
import { getServerConfig } from '../config/env';
import { logger } from '../logging/SafeLogger';
import { toSafeError } from '../logging/SafeError';
import { storage } from '../storage';

const config = getServerConfig();
const GRACE_PERIOD_DAYS = 3;
const stripe = config.stripeSecretKey
  ? new Stripe(config.stripeSecretKey, { apiVersion: '2026-05-27.dahlia' })
  : null;

export interface SubscriptionStatus {
  active: boolean;
  plan?: string;
  currentPeriodEnd?: string;
  gracePeriodEnd?: string;
  stripeCustomerId?: string;
}

export class SubscriptionManager {
  /**
   * Create a Stripe Checkout session for the monthly plan.
   * Returns the hosted checkout URL.
   */
  async createCheckoutSession(userId: number, userEmail: string): Promise<{ url: string }> {
    if (!stripe || !config.stripePriceId) {
      throw new Error('Stripe is not configured.');
    }

    // Check if user already has a Stripe customer ID
    const existing = await storage.getSubscription(userId);
    let customerId = existing?.stripeCustomerId;

    if (!customerId) {
      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { userId: String(userId) },
      });
      customerId = customer.id;

      // Store the customer ID
      await storage.upsertSubscription(userId, {
        stripeCustomerId: customerId,
        status: "inactive",
      });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: config.stripePriceId, quantity: 1 }],
      success_url: `http://127.0.0.1:${config.port}/?checkout=success`,
      cancel_url: `http://127.0.0.1:${config.port}/?checkout=canceled`,
      metadata: { userId: String(userId) },
    });

    if (!session.url) {
      throw new Error("Failed to create checkout session");
    }

    return { url: session.url };
  }

  /**
   * Handle Stripe webhook events.
   * Verifies signature and processes subscription lifecycle events.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!stripe || !config.stripeWebhookSecret) {
      throw new Error('Stripe is not configured.');
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
    } catch (error) {
      logger.warn('Stripe webhook signature validation failed.', { error: toSafeError(error) });
      throw new Error('Webhook signature verification failed.');
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = parseInt(session.metadata?.userId || "0", 10);
        if (!userId) break;

        // Get the subscription details
        const subscriptionId = session.subscription as string;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        await storage.upsertSubscription(userId, {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: subscriptionId,
          status: "active",
          plan: "monthly",
          currentPeriodEnd: subscription.items.data[0]?.current_period_end
            ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
            : undefined,
          gracePeriodEnd: null,
        });

        logger.info('Subscription activated.');
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Find user by Stripe customer ID
        // We'll search through all subscriptions (fine for 50-100 users)
        const userId = await this.findUserByStripeCustomer(customerId);
        if (!userId) break;

        const gracePeriodEnd = new Date(
          Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();

        await storage.upsertSubscription(userId, {
          status: "inactive",
          gracePeriodEnd,
        });

        logger.info('Subscription canceled; grace period started.');
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const userId = await this.findUserByStripeCustomer(customerId);
        if (!userId) break;

        const gracePeriodEnd = new Date(
          Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();

        await storage.upsertSubscription(userId, {
          status: "past_due",
          gracePeriodEnd,
        });

        logger.warn('Subscription payment failed; grace period started.');
        break;
      }

      default:
        // Unhandled event type
        break;
    }
  }

  /**
   * Get the current subscription status for a user.
   */
  async getStatus(userId: number): Promise<SubscriptionStatus> {
    const sub = await storage.getSubscription(userId);

    if (!sub) {
      return { active: false };
    }

    // Check if in grace period
    let isActive = sub.status === "active";
    if (!isActive && sub.gracePeriodEnd) {
      const graceEnd = new Date(sub.gracePeriodEnd);
      if (graceEnd > new Date()) {
        isActive = true; // Grace period still valid
      }
    }

    return {
      active: isActive,
      plan: sub.plan ?? undefined,
      currentPeriodEnd: sub.currentPeriodEnd ?? undefined,
      gracePeriodEnd: sub.gracePeriodEnd ?? undefined,
      stripeCustomerId: sub.stripeCustomerId ?? undefined,
    };
  }

  /**
   * Find a user ID by their Stripe customer ID.
   * Simple linear scan — fine for 50-100 users.
   */
  private async findUserByStripeCustomer(customerId: string): Promise<number | null> {
    // This is a workaround since we don't have a direct lookup method
    // In production with more users, add an index/lookup method to storage
    const { db } = await import("../db");
    const { subscriptions } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const result = db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .get();

    return result?.userId ?? null;
  }
}

export const subscriptionManager = new SubscriptionManager();
