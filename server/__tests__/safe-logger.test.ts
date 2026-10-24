import { describe, expect, it } from '@jest/globals';

import { SafeLogger } from '../logging/SafeLogger';

describe('SafeLogger', () => {
    it('should redact tokens and private interview content before writing', () => {
        const entries: string[] = [];
        const logger = new SafeLogger((entry) => entries.push(entry));
        const accessToken = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
        const refreshToken = 'a'.repeat(80);

        logger.info('Authentication response completed.', {
            authorization: `Bearer ${accessToken}`,
            accessToken,
            refreshToken,
            password: 'do-not-log-password',
            apiKey: 'sk-private-provider-key',
            transcription: 'private interview question',
            aiResponse: 'private generated answer',
            resumeText: 'private resume',
            prompt: 'private prompt',
            response: { email: 'candidate@example.com' },
            safeStatus: 200,
        });

        expect(entries).toHaveLength(1);
        const serializedEntry = entries[0];
        expect(serializedEntry).toContain('[REDACTED]');
        expect(serializedEntry).toContain('safeStatus');
        for (const sensitiveValue of [
            accessToken,
            refreshToken,
            'do-not-log-password',
            'private interview question',
            'private generated answer',
            'private resume',
            'private prompt',
            'candidate@example.com',
        ]) {
            expect(serializedEntry).not.toContain(sensitiveValue);
        }
    });
});
