import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const apiKey = process.env.PATENTSVIEW_API_KEY;
  const body = { q: { patent_id: "10000000" }, f: ["patent_id", "patent_title"] };

  console.log("Request body:", JSON.stringify(body, null, 2));

  const response = await fetch("https://search.patentsview.org/api/v1/patent/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Api-Key": apiKey!
    },
    body: JSON.stringify(body)
  });

  console.log("Status:", response.status);
  const data = await response.json();
  console.log("Response:", JSON.stringify(data, null, 2).substring(0, 500));
}

main().catch(console.error);
