const IDS = [
  "19df746b-e1d6-4c07-aee8-ce11cdfbdf0e",
  "51ed087a-c0bc-4c94-ac32-e676095b9796",
  "524840a0-5f41-45ed-bf5a-592949524fab",
  "65010473-aa3d-4566-80c9-303540a5add2",
  "4142d9be-bb56-4df7-b64d-55b740ddd644",
  "8c5b24cb-55ae-4eda-b77a-2f7abbe3c7e3",
  "bce0c9da-8451-4289-86f4-f083ff19c3f1",
  "e648a761-8542-4809-a008-cbc246fb4d0b",
  "3a6a69e3-6a96-4af6-8eed-8093d6306b89",
  "a7b33f72-c5ae-43e1-bcc0-4fd5b19156b5",
];

const URL = `${process.env.SUPABASE_URL}/functions/v1/parse-syllabus`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function parseOne(id) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
      body: JSON.stringify({ documentId: id }),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
    return { id, status: res.status, ms, body: parsed };
  } catch (e) {
    return { id, error: e.message, ms: Date.now() - t0 };
  }
}

const results = await Promise.all(IDS.map(parseOne));
console.log(JSON.stringify(results, null, 2));
