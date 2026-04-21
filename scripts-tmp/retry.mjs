const URL = `${process.env.SUPABASE_URL}/functions/v1/parse-syllabus`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
  body: JSON.stringify({ documentId: "a7b33f72-c5ae-43e1-bcc0-4fd5b19156b5" }),
});
const text = await res.text();
console.log(res.status, text.slice(0, 500));
