import type { ErrorResponse } from '@kosha/shared/error-codes';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { z } from 'zod';

// A Fastify instance whose route schemas are Zod schemas, so handlers are typed by them
export type KoshaApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export type RegisterRoutes = (app: KoshaApp) => void;

export type AppDeps = {
  // Pino logging; tests turn it off
  logger?: boolean;
  routes?: RegisterRoutes[];
};

const healthResponseSchema = z.object({ status: z.literal('ok') });

// buildApp takes its dependencies rather than reading env or opening connections, so tests can
// drive it with app.inject(). Every error leaves as { error: ErrorCode }.
export const buildApp = ({ logger = true, routes = [] }: AppDeps = {}): KoshaApp => {
  const app: KoshaApp = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ErrorResponse = { error: 'invalid_payload', message: error.message };
      return reply.status(400).send(body);
    }
    request.log.error({ err: error }, '[core]: unhandled error');
    const body: ErrorResponse = { error: 'internal_error' };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ErrorResponse = { error: 'not_found' };
    return reply.status(404).send(body);
  });

  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, () => ({
    status: 'ok' as const
  }));

  for (const register of routes) register(app);
  return app;
};
