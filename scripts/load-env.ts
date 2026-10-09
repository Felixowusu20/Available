import { config } from "dotenv";

// Same precedence as Next.js: variables already in the environment win,
// then .env.local, then .env. dotenv does not override existing keys.
config({ path: ".env.local" });
config({ path: ".env" });
