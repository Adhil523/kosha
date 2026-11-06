// India Standard Time is UTC+05:30 all year (no daylight saving), so a fixed offset is exact.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const MONTHS_PER_QUARTER = 3;
const DEFAULT_FINANCIAL_YEAR_START = '04-01';
const FINANCIAL_YEAR_START_PATTERN = /^(0[1-9]|1[0-2])-01$/;

export type Quarter = 1 | 2 | 3 | 4;

export type FinancialQuarter = {
  // e.g. "2026-27"
  financialYear: string;
  quarter: Quarter;
  // e.g. "2026-Q3": the financial year's start year, then the quarter, as Core's TDS export expects
  key: string;
};

type IstDate = { year: number; month: number; day: number };

const pad2 = (value: number): string => String(value).padStart(2, '0');

const toIst = (date: Date): IstDate => {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('[ist-calendar]: invalid date');
  }
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
};

const startMonthOf = (financialYearStart: string): number => {
  const match = FINANCIAL_YEAR_START_PATTERN.exec(financialYearStart);
  if (!match?.[1]) {
    throw new RangeError(
      `[ist-calendar]: financial year start must be "MM-01", got "${financialYearStart}"`
    );
  }
  return Number(match[1]);
};

// Months since the start of the financial year that contains `ist`, and that year's start year.
const positionInFinancialYear = (ist: IstDate, startMonth: number) => {
  const startYear = ist.month >= startMonth ? ist.year : ist.year - 1;
  const monthIndex = (ist.month - startMonth + 12) % 12;
  return { startYear, monthIndex };
};

const financialYearLabel = (startYear: number): string =>
  `${startYear}-${pad2((startYear + 1) % 100)}`;

// The IST calendar day, e.g. "2026-11-06". Daily spending caps reset on this key.
export const istDayKey = (date: Date): string => {
  const ist = toIst(date);
  return `${ist.year}-${pad2(ist.month)}-${pad2(ist.day)}`;
};

// The financial year containing `date` in IST, e.g. "2026-27". Yearly TDS thresholds reset on this.
export const financialYear = (
  date: Date,
  financialYearStart = DEFAULT_FINANCIAL_YEAR_START
): string => {
  const { startYear } = positionInFinancialYear(toIst(date), startMonthOf(financialYearStart));
  return financialYearLabel(startYear);
};

// The TDS quarter containing `date` in IST. With an April start: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar.
export const quarterOf = (
  date: Date,
  financialYearStart = DEFAULT_FINANCIAL_YEAR_START
): FinancialQuarter => {
  const { startYear, monthIndex } = positionInFinancialYear(
    toIst(date),
    startMonthOf(financialYearStart)
  );
  const quarter = (Math.floor(monthIndex / MONTHS_PER_QUARTER) + 1) as Quarter;
  return { financialYear: financialYearLabel(startYear), quarter, key: `${startYear}-Q${quarter}` };
};
