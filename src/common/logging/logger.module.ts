import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { config } from 'zod/v4/core';




export const AppLoggerModule = LoggerModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        const isProd = nodeEnv === 'production';
        const isTest = nodeEnv === 'test';

        return {
            pinoHttp: {
                level: isTest ? 'silent' : isProd ? 'info' : 'debug',
                genReqId: (req, res) => {
                    const incoming = req.headers['x-request-id'];
                    const id =
                        typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 100
                            ? incoming
                            : randomUUID();
                    res.setHeader('x-request-id', id);
                    return id;
                },
                redact: {
                    paths: ['req.headers.authorization', 'req.headers.cookie'],
                    censor: '[redacted]',
                },
                autoLogging: { ignore: (req) => req.url?.startsWith('/v1/health') ?? false },
                transport:
                    isProd || isTest
                        ? undefined
                        : { target: 'pino-pretty', options: { singleLine: true } },
            },
        };
    },
});