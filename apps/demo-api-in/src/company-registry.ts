import data from './companies.json' with { type: 'json' };
import { z } from 'zod';

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

export const gstinSchema = z.string().trim().toUpperCase().regex(GSTIN_PATTERN);
export const cinSchema = z.string().trim().toUpperCase().regex(CIN_PATTERN);

const companySchema = z.strictObject({
  cin: cinSchema,
  gstin: gstinSchema,
  legalName: z.string().min(1),
  tradeName: z.string().min(1),
  state: z.string().min(1),
  industry: z.string().min(1),
  incorporatedOn: z.iso.date(),
  gstRegisteredOn: z.iso.date(),
  gstStatus: z.enum(['Active', 'Cancelled']),
  paidUpCapitalInr: z.int().positive()
});

export type Company = z.output<typeof companySchema>;

// Mock data (fictional companies), checked once at startup so a typo fails loudly
const COMPANIES: readonly Company[] = z.array(companySchema).parse(data.companies);

export const findByGstin = (gstin: string): Company | undefined =>
  COMPANIES.find((entry) => entry.gstin === gstin);

export const findByCin = (cin: string): Company | undefined =>
  COMPANIES.find((entry) => entry.cin === cin);
