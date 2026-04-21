import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const FILES = [
  { file: "PSLE_EL_0001.pdf",       title: "PSLE English Language",         code: "0001", subject: "English Language", level: "P6" },
  { file: "PSLE_Math_0001.pdf",     title: "PSLE Mathematics",              code: "0001", subject: "Mathematics",      level: "P6" },
  { file: "PSLE_Sci_0009.pdf",      title: "PSLE Science",                  code: "0009", subject: "Science",          level: "P6" },
  { file: "Foundation_EL_0031.pdf", title: "PSLE Foundation English Language", code: "0031", subject: "English Language", level: "P6 Foundation" },
  { file: "Foundation_Math_0038.pdf", title: "PSLE Foundation Mathematics", code: "0038", subject: "Mathematics",      level: "P6 Foundation" },
  { file: "Foundation_Sci_0039.pdf",  title: "PSLE Foundation Science",     code: "0039", subject: "Science",          level: "P6 Foundation" },
];

const ids = [];
for (const f of FILES) {
  const localPath = path.join("/tmp/uploads", f.file);
  const bytes = await readFile(localPath);
  const storagePath = `${randomUUID()}.pdf`;
  const { error: upErr } = await supabase.storage.from("syllabi").upload(storagePath, bytes, { contentType: "application/pdf" });
  if (upErr) { console.log(`✗ ${f.file}: ${upErr.message}`); continue; }
  const { data: row, error: insErr } = await supabase.from("syllabus_documents").insert({
    title: f.title, syllabus_code: f.code, exam_board: "MOE", syllabus_year: 2026,
    subject: f.subject, level: f.level, file_path: storagePath, mime_type: "application/pdf", parse_status: "pending",
  }).select().single();
  if (insErr) { console.log(`✗ ${f.file}: ${insErr.message}`); continue; }
  ids.push(row.id);
  console.log(`✓ ${f.file} → ${row.id}`);
}

// Trigger parses in parallel (fire-and-forget; won't await — they often outlive the 150s edge timeout)
const URL = `${process.env.SUPABASE_URL}/functions/v1/parse-syllabus`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("\nTriggering parses…");
await Promise.all(ids.map(async id => {
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
      body: JSON.stringify({ documentId: id }),
    });
    const txt = await r.text();
    console.log(`  ${id} → ${r.status} (${Date.now()-t0}ms): ${txt.slice(0,120)}`);
  } catch (e) {
    console.log(`  ${id} → fetch error: ${e.message}`);
  }
}));
