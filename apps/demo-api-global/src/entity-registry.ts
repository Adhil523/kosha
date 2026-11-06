import data from './entities.json' with { type: 'json' };
import { z } from 'zod';

const LEI_PATTERN = /^[0-9A-Z]{18}\d{2}$/;
const LETTER_OFFSET = 55; // ISO 7064: A → 10 … Z → 35

// ISO 17442 check digits (ISO 7064 mod 97-10): the LEI read as a number leaves remainder 1
const hasValidCheckDigits = (lei: string): boolean => {
  const digits = [...lei]
    .map((char) => (/\d/.test(char) ? char : String(char.charCodeAt(0) - LETTER_OFFSET)))
    .join('');
  return BigInt(digits) % 97n === 1n;
};

export const leiSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(LEI_PATTERN)
  .refine(hasValidCheckDigits, 'check digits do not match');

const entitySchema = z.strictObject({
  lei: leiSchema,
  legalName: z.string().min(1),
  // ISO 3166-1 alpha-2
  country: z.string().regex(/^[A-Z]{2}$/),
  jurisdiction: z.string().min(1),
  sector: z.string().min(1),
  registeredOn: z.iso.date(),
  status: z.enum(['ISSUED', 'LAPSED'])
});

export type Entity = z.output<typeof entitySchema>;

// Mock data (fictional entities), checked once at startup so a typo fails loudly
const ENTITIES: readonly Entity[] = z.array(entitySchema).parse(data.entities);

export const findByLei = (lei: string): Entity | undefined =>
  ENTITIES.find((entry) => entry.lei === lei);
