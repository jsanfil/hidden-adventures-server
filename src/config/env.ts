import { config } from "dotenv";
import { z } from "zod";

config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().default("hidden_adventures"),
  POSTGRES_USER: z.string().default("hidden_adventures"),
  POSTGRES_PASSWORD: z.string().default("hidden_adventures"),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  AWS_REGION: z.string().default("us-west-2"),
  S3_BUCKET: z.string().optional()
});

export const env = EnvSchema.parse(process.env);

