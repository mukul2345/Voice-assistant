import { describe, expect, it } from '@jest/globals';

import {
    ConfigurationErrorCode,
    parseServerConfig,
} from '../config/env';

const VALID_SECRET = 'a-secure-production-secret-that-is-long-enough';

function productionEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
        NODE_ENV: 'production',
        PORT: '5000',
        JWT_SECRET: VALID_SECRET,
        GROQ_API_KEY: 'test-provider-key',
        ...overrides,
    };
}

describe('server configuration', () => {
    it('should fail startup when the production JWT secret is missing', () => {
        const environment = productionEnvironment();
        delete environment.JWT_SECRET;

        expect(() => parseServerConfig(environment)).toThrow(
            expect.objectContaining({
                code: ConfigurationErrorCode.INVALID_JWT_SECRET,
            }),
        );
    });

    it('should reject an out-of-range port', () => {
        expect(() => parseServerConfig(productionEnvironment({ PORT: '70000' }))).toThrow(
            expect.objectContaining({
                code: ConfigurationErrorCode.INVALID_PORT,
            }),
        );
    });

    it('should reject partial Stripe configuration', () => {
        expect(() => parseServerConfig(productionEnvironment({ STRIPE_SECRET_KEY: 'sk_test_value' }))).toThrow(
            expect.objectContaining({
                code: ConfigurationErrorCode.PARTIAL_STRIPE_CONFIGURATION,
            }),
        );
    });
});
