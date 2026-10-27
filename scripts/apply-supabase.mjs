// Runs a SQL file on the Supabase project with the Management API.
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-supabase.mjs <project-ref> supabase/migrations/001_group.sql
// The token is a personal access token (Supabase dashboard > Account > Access Tokens). It can do anything in the account:
// give it a short life and delete it afterwards. It is never stored in the project.
import { readFileSync } from 'node:fs'

const [ref, file] = process.argv.slice(2)
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !file || !token) {
  console.error('usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-supabase.mjs <project-ref> <file.sql>')
  process.exit(2)
}
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: readFileSync(file, 'utf8') }),
})
const text = await response.text()
console.log(response.status, text.slice(0, 2000))
process.exit(response.ok ? 0 : 1)
