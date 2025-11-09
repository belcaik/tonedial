import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().default(8080),
    API_JWT_SECRET: z.string().min(16, 'API_JWT_SECRET must be at least 16 characters'),
    API_ENABLE_HTTPS: booleanFromEnv.default(false),
    API_TLS_CERT_PATH: z.string().optional(),
    API_TLS_KEY_PATH: z.string().optional(),
    STEAM_API_KEY: z.string().optional(),
    STEAM_RETURN_URL: z.string().url().optional(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    PGHOST: z.string().default('localhost'),
    PGPORT: z.coerce.number().default(5432),
    PGDATABASE: z.string().default('tonedial'),
    PGUSER: z.string().default('postgres'),
    PGPASSWORD: z.string().default('postgres'),
  })
  .superRefine((value, ctx) => {
    if (value.API_ENABLE_HTTPS && (!value.API_TLS_CERT_PATH || !value.API_TLS_KEY_PATH)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_TLS_CERT_PATH'],
        message: 'API_TLS_CERT_PATH and API_TLS_KEY_PATH are required when API_ENABLE_HTTPS=true',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = {
  ...parsed.data,
  get databaseUrl() {
    const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = parsed.data;
    return `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  },
};
