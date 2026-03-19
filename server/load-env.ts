/**
 * Must be imported first so .env is loaded before any code reads process.env.
 * In ESM, imports run before module body, so dotenv must run in an imported module.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let result = dotenv.config({ path: path.resolve(process.cwd(), ".env") });
if (result.error) {
  result = dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}
