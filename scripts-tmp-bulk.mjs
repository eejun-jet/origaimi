import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const FILES = [
  { file: "Comb_Geo_2260.pdf",   title: "Combined Humanities (Geography) 2260", code: "2260", subject: "Humanities",        level: "Sec 4" },
  { file: "Comb_Hist_2261.pdf",  title: "Combined Humanities (History) 2261",   code: "2261", subject: "Humanities",        level: "Sec 4" },
  { file: "Comb_Lit_2262.pdf",   title: "Combined Humanities (Literature) 2262",code: "2262", subject: "Humanities",        level: "Sec 4" },
  { file: "Comb_Sci_5086.pdf",   title: "Combined Science 5086",                code: "5086", subject: "Science",           level: "Sec 4" },
  { file: "EL_1184.pdf",         title: "English Language 1184",                code: "1184", subject: "English Language",  level: "Sec 4" },
  { file: "EMath_4052.pdf",      title: "Elementary Mathematics 4052",          code: "4052", subject: "Mathematics",      level: "Sec 4" },
  { file: "N_Comb_Geo_2125.pdf", title: "N(A) Combined Humanities (Geography) 2125", code: "2125", subject: "Humanities",   level: "Sec 4N" },
  { file: "N_Comb_Hist_2126.pdf",title: "N(A) Combined Humanities (History) 2126",   code: "2126", subject: "Humanities",   level: "Sec 4N" },
  { file: "N_Comb_Lit_2127.pdf", title: "N(A) Combined Humanities (Literature) 2127",code: "2127", subject: "Humanities",   level: "Sec 4N" },
  { file: "N_Comb_Sci_5105.pdf", title: "N(A) Combined Science 5105/5106/5107", code: "5105/5106/5107", subject: "Science", level: "Sec 4N" },
];

const results = [];
for (const f of FILES) {
  try {
    const localPath = path.join("/tmp/uploads", f.file);
    const bytes = await readFile(localPath);
    const storagePath = `${randomUUID()}.pdf`;

    const { error: upErr } = await supabase.storage.from("syllabi").upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const { data: row, error: insErr } = await supabase
      .from("syllabus_documents")
      .insert({
        title: f.title,
        syllabus_code: f.code,
        exam_board: "MOE",
        syllabus_year: 2026,
        subject: f.subject,
        level: f.level,
        file_path: storagePath,
        mime_type: "application/pdf",
        parse_status: "pending",
      })
      .select()
      .single();
    if (insErr) throw new Error(`insert: ${insErr.message}`);

    results.push({ file: f.file, id: row.id, ok: true });
    console.log(`✓ ${f.file} → ${row.id}`);
  } catch (e) {
    results.push({ file: f.file, ok: false, error: e.message });
    console.log(`✗ ${f.file}: ${e.message}`);
  }
}

console.log("\nSUMMARY:", JSON.stringify(results, null, 2));
