import { config } from "dotenv";
import { z } from "zod";

config();

const AuthModeSchema = z.enum(["cognito", "local_identity", "test_jwt"]);
const ServerRuntimeModeSchema = z.enum([
  "local_manual_qa",
  "local_automation_test_core",
  "production"
]);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().default("hidden_adventures"),
  POSTGRES_USER: z.string().default("hidden_adventures"),
  POSTGRES_PASSWORD: z.string().default("hidden_adventures"),
  AUTH_MODE: AuthModeSchema.optional(),
  SERVER_RUNTIME_MODE: ServerRuntimeModeSchema.optional(),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  AWS_REGION: z.string().default("us-west-2"),
  S3_BUCKET: z.string().optional(),
  LOCAL_BACKUP_DIR: z.string().optional(),
  FIXTURE_COGNITO_PASSWORD: z.string().optional(),
  TEST_JWT_ISSUER: z.string().optional(),
  TEST_JWT_AUDIENCE: z.string().optional(),
  TEST_JWT_PUBLIC_KEY: z.string().optional(),
  TEST_JWT_PUBLIC_KEY_FILE: z.string().optional(),
  TEST_JWT_PRIVATE_KEY: z.string().optional(),
  TEST_JWT_PRIVATE_KEY_FILE: z.string().optional()
});

const parsedEnv = EnvSchema.parse(process.env);

export type AuthMode = z.infer<typeof AuthModeSchema>;

const authMode: AuthMode =
  parsedEnv.AUTH_MODE ?? (parsedEnv.NODE_ENV === "production" ? "cognito" : "test_jwt");

const serverRuntimeMode =
  parsedEnv.SERVER_RUNTIME_MODE ?? (parsedEnv.NODE_ENV === "production" ? "production" : "local_automation_test_core");

if (parsedEnv.NODE_ENV === "production" && authMode !== "cognito") {
  throw new Error('AUTH_MODE must be "cognito" when NODE_ENV is "production".');
}

export const env = {
  ...parsedEnv,
  AUTH_MODE: authMode,
  SERVER_RUNTIME_MODE: serverRuntimeMode
};
