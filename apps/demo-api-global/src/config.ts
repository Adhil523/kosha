import { z } from 'zod';

const DEFAULT_PORT = 4102;
const DEFAULT_CONSOLE_URL = 'http://localhost:3000';
// The Console page where an agent owner registers for Level 1
const REGISTRATION_PATH = '/agents';

const envSchema = z.object({
  CORE_URL: z.url(),
  DEMO_API_GLOBAL_KEY: z.string().min(1),
  DEMO_API_GLOBAL_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_PORT),
  CONSOLE_URL: z.url().default(DEFAULT_CONSOLE_URL)
});

export type DemoApiConfig = {
  core: string;
  apiKey: string;
  port: number;
  registrationUrl: string;
};

export type LoadedConfig =
  { ok: true; data: DemoApiConfig } | { ok: false; data: { problems: string[] } };

// Names every missing or invalid key, never its value: the API key is a secret
export const loadConfig = (env: NodeJS.ProcessEnv): LoadedConfig => {
  const present = Object.fromEntries(
    Object.keys(envSchema.shape).flatMap((key) => {
      const value = env[key]?.trim();
      return value ? [[key, value]] : [];
    })
  );
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const problems = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    return { ok: false, data: { problems } };
  }
  const { CORE_URL, DEMO_API_GLOBAL_KEY, DEMO_API_GLOBAL_PORT, CONSOLE_URL } = parsed.data;
  return {
    ok: true,
    data: {
      core: CORE_URL,
      apiKey: DEMO_API_GLOBAL_KEY,
      port: DEMO_API_GLOBAL_PORT,
      registrationUrl: new URL(REGISTRATION_PATH, CONSOLE_URL).toString()
    }
  };
};
