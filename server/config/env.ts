import crypto from 'crypto';
import path from 'path';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ServerConfig {
    readonly nodeEnvironment: NodeEnvironment;
    readonly port: number;
    readonly jwtSecret: string;
    readonly dataDirectory: string;
    readonly uploadsDirectory: string;
    readonly groqApiKey?: string;
    readonly openAiApiKey?: string;
    readonly openAiBaseUrl?: string;
    readonly stripeSecretKey?: string;
    readonly stripeWebhookSecret?: string;
    readonly stripePriceId?: string;
}

export enum ConfigurationErrorCode {
    INVALID_ENVIRONMENT = 'INVALID_ENVIRONMENT',
    INVALID_PORT = 'INVALID_PORT',
    INVALID_JWT_SECRET = 'INVALID_JWT_SECRET',
    MISSING_AI_PROVIDER = 'MISSING_AI_PROVIDER',
    PARTIAL_STRIPE_CONFIGURATION = 'PARTIAL_STRIPE_CONFIGURATION',
}

/** Describes invalid or incomplete process configuration. */
export class ConfigurationError extends Error {
    public readonly code: ConfigurationErrorCode;

    public constructor({ code, message }: { code: ConfigurationErrorCode; message: string }) {
        super(message);
        this.code = code;
        this.name = 'ConfigurationError';
    }
}

const MINIMUM_JWT_SECRET_LENGTH = 32;
const UNSAFE_JWT_SECRETS = new Set([
    'dev-jwt-secret-change-in-production',
    'change-this-to-a-random-secret-in-production',
]);

let cachedConfig: ServerConfig | undefined;
function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
    const nodeEnvironment = value ?? 'development';
    if (nodeEnvironment === 'development' || nodeEnvironment === 'test' || nodeEnvironment === 'production') {
        return nodeEnvironment;
    }

    throw new ConfigurationError({
        code: ConfigurationErrorCode.INVALID_ENVIRONMENT,
        message: `NODE_ENV must be development, test, or production; received ${nodeEnvironment}.`,
    });
}

function parsePort(value: string | undefined): number {
    const port = Number(value ?? '5000');
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new ConfigurationError({
            code: ConfigurationErrorCode.INVALID_PORT,
            message: 'PORT must be an integer between 0 and 65535.',
        });
    }
    return port;
}

function resolveJwtSecret(environment: NodeJS.ProcessEnv, nodeEnvironment: NodeEnvironment): string {
    const configuredSecret = environment.JWT_SECRET?.trim();
    if (!configuredSecret && nodeEnvironment !== 'production') {
        return crypto.randomBytes(48).toString('hex');
    }

    if (
        !configuredSecret ||
        configuredSecret.length < MINIMUM_JWT_SECRET_LENGTH ||
        UNSAFE_JWT_SECRETS.has(configuredSecret)
    ) {
        throw new ConfigurationError({
            code: ConfigurationErrorCode.INVALID_JWT_SECRET,
            message: `JWT_SECRET must be a non-placeholder secret of at least ${MINIMUM_JWT_SECRET_LENGTH} characters.`,
        });
    }
    return configuredSecret;
}

function validateAiProvider(environment: NodeJS.ProcessEnv, nodeEnvironment: NodeEnvironment): void {
    if (nodeEnvironment !== 'production') {
        return;
    }
    if (!environment.GROQ_API_KEY?.trim() && !environment.AI_INTEGRATIONS_OPENAI_API_KEY?.trim()) {
        throw new ConfigurationError({
            code: ConfigurationErrorCode.MISSING_AI_PROVIDER,
            message: 'Production requires GROQ_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY.',
        });
    }
}
function validateStripeConfiguration(environment: NodeJS.ProcessEnv): void {
    const stripeValues = [
        environment.STRIPE_SECRET_KEY?.trim(),
        environment.STRIPE_WEBHOOK_SECRET?.trim(),
        environment.STRIPE_PRICE_ID?.trim(),
    ];
    const configuredValueCount = stripeValues.filter(Boolean).length;
    if (configuredValueCount > 0 && configuredValueCount < stripeValues.length) {
        throw new ConfigurationError({
            code: ConfigurationErrorCode.PARTIAL_STRIPE_CONFIGURATION,
            message: 'Stripe requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRICE_ID together.',
        });
    }
}

/** Validates environment variables and returns immutable server configuration. */
export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
    const nodeEnvironment = parseNodeEnvironment(environment.NODE_ENV);
    validateAiProvider(environment, nodeEnvironment);
    validateStripeConfiguration(environment);

    const dataDirectory = path.resolve(environment.COPILOT_DATA_DIR?.trim() || path.join(process.cwd(), 'data'));
    return Object.freeze({
        nodeEnvironment,
        port: parsePort(environment.PORT),
        jwtSecret: resolveJwtSecret(environment, nodeEnvironment),
        dataDirectory,
        uploadsDirectory: path.join(dataDirectory, 'uploads'),
        groqApiKey: environment.GROQ_API_KEY?.trim() || undefined,
        openAiApiKey: environment.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() || undefined,
        openAiBaseUrl: environment.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || undefined,
        stripeSecretKey: environment.STRIPE_SECRET_KEY?.trim() || undefined,
        stripeWebhookSecret: environment.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
        stripePriceId: environment.STRIPE_PRICE_ID?.trim() || undefined,
    });
}

/** Returns the validated process configuration for the current server process. */
export function getServerConfig(): ServerConfig {
    cachedConfig ??= parseServerConfig(process.env);
    return cachedConfig;
}

/** Clears cached configuration for isolated tests. */
export function resetServerConfigForTests(): void {
    cachedConfig = undefined;
}
