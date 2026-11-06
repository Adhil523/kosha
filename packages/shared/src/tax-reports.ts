import { accountIdSchema, scheduleIdSchema, transactionIdSchema } from './ids';
import { amountSchema, signedAmountSchema } from './money';
import { z } from 'zod';

export const TDS_SECTION = '393(1)';
// "2026-11": a calendar month, for the monthly close
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
// "2026-Q3": a quarter of the financial year, for the TDS statement
export const quarterSchema = z.string().regex(/^\d{4}-Q[1-4]$/);

// GET /v1/exports/tds: one row per payment, deductee-wise. The CSV header follows these keys.
export const tdsExportRowSchema = z.object({
  // Masked, never the PAN itself, e.g. "AAPFU****F"
  deducteeRef: z.string().min(1),
  considerationPaise: amountSchema,
  tdsPaise: amountSchema,
  rateBps: z.int().min(0).max(10_000),
  // Mode C: the deductee funded its own TDS into its reserve
  fundedBy: z.literal('deductee_reserve'),
  paymentDate: z.iso.date(),
  deductionDate: z.iso.date(),
  section: z.literal(TDS_SECTION),
  hcsSequence: z.int().positive().nullable(),
  transactionId: transactionIdSchema
});

// GET /v1/close?receiverId=&month=: what the deductor pays on the income-tax portal
export const monthlyCloseSchema = z.object({
  receiverId: z.string().min(1),
  month: monthSchema,
  section: z.literal(TDS_SECTION),
  // TAN, or PAN for a specified person, masked
  deductorRef: z.string().min(1),
  totalTdsPaise: amountSchema,
  rows: z.array(
    z.object({
      agentId: z.string().min(1),
      deducteeRef: z.string().min(1),
      tdsPaise: amountSchema,
      tdsMicro: amountSchema,
      reserveAccountId: accountIdSchema
    })
  )
});

// POST /v1/challans: the reference is hashed before it is stored or logged
export const challanRecordSchema = z.object({
  receiverId: z.string().min(1),
  month: monthSchema,
  challanRef: z.string().min(1)
});

export const challanRowSchema = z.object({
  id: z.string().min(1),
  receiverId: z.string().min(1),
  month: monthSchema,
  tdsPaise: amountSchema,
  recordedAt: z.iso.datetime(),
  hcsSequence: z.int().positive().nullable()
});

// One scheduled release per payer reserve: reserve → deductor, as reimbursement
export const releaseRowSchema = z.object({
  id: z.string().min(1),
  challanId: z.string().min(1),
  agentId: z.string().min(1),
  reserveAccountId: accountIdSchema,
  micro: amountSchema,
  scheduleId: scheduleIdSchema.nullable(),
  status: z.enum(['pending', 'scheduled', 'executed', 'expired', 'deleted']),
  cosignedBy: z.string().nullable()
});

// POST /v1/outside-payments/:id/classify; a gift needs a note
export const outsideClassifySchema = z
  .object({
    classification: z.enum(['consideration', 'not_consideration_gift']),
    note: z.string().min(1).optional()
  })
  .refine((body) => body.classification !== 'not_consideration_gift' || body.note, {
    path: ['note'],
    message: 'marking a transfer as a gift needs a note'
  });

// GET /v1/payers/:id/report: INR value and gain or loss per lot spent
export const payerReportRowSchema = z.object({
  paymentId: z.string().min(1),
  spentAt: z.iso.datetime(),
  micro: amountSchema,
  inrValuePaise: amountSchema,
  costPaise: amountSchema,
  gainPaise: signedAmountSchema
});

export type TdsExportRow = z.output<typeof tdsExportRowSchema>;
export type MonthlyClose = z.output<typeof monthlyCloseSchema>;
export type ChallanRecord = z.output<typeof challanRecordSchema>;
export type ChallanRow = z.output<typeof challanRowSchema>;
export type ReleaseRow = z.output<typeof releaseRowSchema>;
export type OutsideClassify = z.output<typeof outsideClassifySchema>;
export type PayerReportRow = z.output<typeof payerReportRowSchema>;
