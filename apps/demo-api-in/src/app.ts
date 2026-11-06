import { cinSchema, type Company, findByCin, findByGstin, gstinSchema } from './company-registry';
import { koshaGate, type KoshaGateOptions } from '@kosha/gate/express-middleware';
import { type TermsOptions } from '@kosha/gate/kosha-terms';
import express from 'express';

export const PATHS = {
  health: '/health',
  gstLookup: '/v1/gst-lookup',
  company: '/v1/company/:cin'
} as const;

// Net prices: this API receives exactly these, and any TDS is added on top for the payer
export const ROUTES = {
  [`GET ${PATHS.gstLookup}`]: { priceUsdc: '0.10', description: 'GSTIN registration and status' },
  [`GET ${PATHS.company}`]: { priceUsdc: '0.25', description: 'Company master data by CIN' }
};

// Static for now: the owner's terms as Core holds them for receiver-in
const TERMS: Omit<TermsOptions, 'registrationUrl'> = {
  rulepack: 'in-2026.2',
  unverifiedPolicy: 'threshold_tolerant',
  acceptedLevels: [0, 1, 2]
};

export type AppOptions = Omit<KoshaGateOptions, 'routes' | 'terms'> & {
  registrationUrl?: string;
};

const registrationOf = (company: Company) => ({
  gstin: company.gstin,
  legalName: company.legalName,
  tradeName: company.tradeName,
  state: company.state,
  status: company.gstStatus,
  registeredOn: company.gstRegisteredOn
});

const masterDataOf = (company: Company) => ({
  cin: company.cin,
  legalName: company.legalName,
  state: company.state,
  industry: company.industry,
  incorporatedOn: company.incorporatedOn,
  paidUpCapitalInr: company.paidUpCapitalInr,
  gstins: [company.gstin]
});

// A mock Indian company-data API, priced per call through Kosha Gate
export const buildApp = (options: AppOptions): express.Express => {
  const { registrationUrl, ...gate } = options;
  const app = express();

  app.get(PATHS.health, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(koshaGate({ ...gate, routes: ROUTES, terms: { ...TERMS, registrationUrl } }));

  app.get(PATHS.gstLookup, (req, res) => {
    const gstin = gstinSchema.safeParse(req.query.gstin);
    if (!gstin.success) {
      res.status(400).json({ message: 'Pass ?gstin= with a 15-character GSTIN.' });
      return;
    }
    const company = findByGstin(gstin.data);
    if (!company) {
      res.status(404).json({ message: `No registration found for GSTIN ${gstin.data}.` });
      return;
    }
    res.json({ registration: registrationOf(company), paidBy: req.kosha?.agentId ?? null });
  });

  app.get(PATHS.company, (req, res) => {
    const cin = cinSchema.safeParse(req.params.cin);
    if (!cin.success) {
      res.status(400).json({ message: 'Pass a 21-character CIN in the path.' });
      return;
    }
    const company = findByCin(cin.data);
    if (!company) {
      res.status(404).json({ message: `No company found for CIN ${cin.data}.` });
      return;
    }
    res.json({ company: masterDataOf(company), paidBy: req.kosha?.agentId ?? null });
  });

  return app;
};
