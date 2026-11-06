import { findByLei, leiSchema } from './entity-registry';
import { koshaGate, type KoshaGateOptions } from '@kosha/gate/express-middleware';
import { type TermsOptions } from '@kosha/gate/kosha-terms';
import express from 'express';

export const PATHS = {
  health: '/health',
  lei: '/v1/lei/:lei'
} as const;

// Net price. The owner is not resident in India, so Core quotes no TDS on top.
export const ROUTES = {
  [`GET ${PATHS.lei}`]: { priceUsdc: '0.05', description: 'Legal entity record by LEI' }
};

// Static for now: the owner's terms as Core holds them for receiver-global
const TERMS: Omit<TermsOptions, 'registrationUrl'> = {
  rulepack: 'in-2026.2',
  unverifiedPolicy: 'threshold_tolerant',
  acceptedLevels: [0, 1, 2]
};

export type AppOptions = Omit<KoshaGateOptions, 'routes' | 'terms'> & {
  registrationUrl?: string;
};

// A mock overseas legal-entity API, priced per call through Kosha Gate
export const buildApp = (options: AppOptions): express.Express => {
  const { registrationUrl, ...gate } = options;
  const app = express();

  app.get(PATHS.health, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(koshaGate({ ...gate, routes: ROUTES, terms: { ...TERMS, registrationUrl } }));

  app.get(PATHS.lei, (req, res) => {
    const lei = leiSchema.safeParse(req.params.lei);
    if (!lei.success) {
      res.status(400).json({ message: 'Pass a 20-character LEI with valid check digits.' });
      return;
    }
    const entity = findByLei(lei.data);
    if (!entity) {
      res.status(404).json({ message: `No entity found for LEI ${lei.data}.` });
      return;
    }
    res.json({ entity, paidBy: req.kosha?.agentId ?? null });
  });

  return app;
};
