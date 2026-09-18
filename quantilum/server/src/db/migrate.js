import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../../migrations");

async function run() {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

  console.log(`Found ${files.length} migration file(s).`);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`Running ${file}...`);
    try {
      await pool.query(sql);
      console.log(`  ✔ ${file} applied`);
    } catch (err) {
      console.error(`  ✘ ${file} failed:`, err.message);
      process.exit(1);
    }
  }

  console.log("All migrations applied.");
  await pool.end();
}

run();
