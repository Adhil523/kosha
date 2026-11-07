import type { RegisterRoutes } from './app';
import type { FxRate, FxSource } from './fx';
import type { CreFx } from './fx-cre';
import {
  creReportPayloadSchema,
  type CreTrust,
  FX_REPORT_ERRORS,
  verifyFxReport
} from './fx-report';
import { z } from 'zod';

const FX_ROUTE_ERRORS = {
  disabled: 'fx_report_disabled',
  localOnly: 'fx_report_local_only'
} as const;

const fxErrorSchema = z.object({
  error: z.enum([...Object.values(FX_ROUTE_ERRORS), ...Object.values(FX_REPORT_ERRORS)]),
  message: z.string()
});

const fxRateSchema = z.object({
  inrPerUsdMicro: z.string(),
  source: z.string(),
  asOf: z.string()
});

const reportResponseSchema = z.object({
  applied: z.boolean(),
  reportHash: z.string(),
  rate: fxRateSchema
});

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const rateBody = (rate: FxRate) => ({
  inrPerUsdMicro: rate.inrPerUsdMicro.toString(),
  source: rate.source,
  asOf: rate.asOf.toISOString()
});

export type FxRouteDeps = {
  // The rate quotes use: the CRE source when configured, else the fallback
  fx: FxSource;
  cre: { fx: CreFx; trust: CreTrust } | null;
};

// GET /v1/fx: the rate Core quotes with, and where it came from.
// POST /v1/fx/report: a signed report from the kosha-fx Chainlink CRE workflow (cre/kosha-fx).
export const fxRoutes =
  (deps: FxRouteDeps): RegisterRoutes =>
  (app) => {
    app.get('/v1/fx', { schema: { response: { 200: fxRateSchema } } }, async () =>
      rateBody(await deps.fx.current())
    );

    app.post(
      '/v1/fx/report',
      {
        schema: {
          body: creReportPayloadSchema,
          response: {
            200: reportResponseSchema,
            400: fxErrorSchema,
            401: fxErrorSchema,
            403: fxErrorSchema,
            503: fxErrorSchema
          }
        }
      },
      async (request, reply) => {
        if (!deps.cre) {
          return reply
            .status(503)
            .send({ error: FX_ROUTE_ERRORS.disabled, message: 'CRE_FX_TRUST is not set' });
        }
        // Simulated reports carry throwaway keys, so only this machine may send them
        if (deps.cre.trust.mode === 'simulation' && !LOOPBACK.has(request.ip)) {
          return reply.status(403).send({
            error: FX_ROUTE_ERRORS.localOnly,
            message: 'simulated reports are accepted only from this machine'
          });
        }

        const verified = await verifyFxReport(request.body, deps.cre.trust);
        if (!verified.ok) {
          const status = verified.data.error === FX_REPORT_ERRORS.notSigned ? 401 : 400;
          return reply.status(status).send(verified.data);
        }
        const applied = deps.cre.fx.accept(verified.data);
        request.log.info(
          { applied, reportHash: verified.data.reportHash },
          '[fx]: kosha-fx report verified'
        );
        return {
          applied,
          reportHash: verified.data.reportHash,
          rate: rateBody(await deps.fx.current())
        };
      }
    );
  };
