import fs from 'node:fs';
import path from 'node:path';

const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.png', '.jpg', '.jpeg']);

export function listAttachmentFiles(folderPath) {
  if (!fs.existsSync(folderPath)) throw new Error(`Folder not found: ${folderPath}`);
  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${folderPath}`);
  return fs.readdirSync(folderPath)
    .filter((f) => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()))
    .sort();
}

function normStr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ').trim();
}

function fuzzyMatch(name, filenames, usedFiles) {
  const parts = normStr(name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const candidates = filenames.filter((f) => {
    if (usedFiles.has(f)) return false;
    const nf = normStr(f);
    return parts.every((p) => nf.includes(p));
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return candidates.sort((a, b) => a.length - b.length)[0];
  return null;
}

async function aiMatch(recipients, filenames, apiKey) {
  const prompt = `You are matching payroll attachment files to employee recipients.

Recipients (JSON):
${JSON.stringify(recipients.map((r) => ({ email: r.email, name: r.name })), null, 2)}

Available files:
${filenames.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Match each recipient to their file. Be flexible: handle different separators (space, underscore, hyphen, dot), case differences, reversed name order (last first vs first last), accents, initials, and abbreviations.

Return ONLY a JSON array — no explanation, no markdown. Format:
[{"email":"...","filename":"...","confidence":"high|medium|low"}]

Only include recipients you matched. Skip unmatched ones.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}`);  // don't surface raw API response
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Extract JSON array — handle fences, leading text, trailing text
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude returned no JSON array in matching response.');
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Claude returned malformed JSON in matching response.');
  }
}

export async function matchAttachments(recipients, folderPath, apiKey) {
  const files = listAttachmentFiles(folderPath);
  if (files.length === 0) throw new Error(`No supported files found in ${folderPath}`);

  let aiResults = [];
  const aiErrors = [];

  if (apiKey) {
    try {
      aiResults = await aiMatch(recipients, files, apiKey);
    } catch (err) {
      aiErrors.push(err.message);
    }
  }

  // Keyed by email; also validate that filenames returned by AI actually exist
  const aiMap = new Map(
    aiResults
      .filter((r) => r.email && r.filename && files.includes(r.filename))
      .map((r) => [r.email.toLowerCase(), r])
  );

  const matched = [];
  const unmatched = [];
  const usedFiles = new Set();

  for (const recipient of recipients) {
    const emailKey = recipient.email.toLowerCase();
    let filename = null;
    let confidence = 'low';

    // 1. AI result — only use if file not already taken by an earlier recipient
    const aiHit = aiMap.get(emailKey);
    if (aiHit && !usedFiles.has(aiHit.filename)) {
      filename = aiHit.filename;
      confidence = aiHit.confidence || 'high';
    }

    // 2. Fuzzy fallback — skips already-used files internally
    if (!filename) {
      filename = fuzzyMatch(recipient.name, files, usedFiles);
      if (filename) confidence = 'medium';
    }

    if (filename) {
      matched.push({
        email: recipient.email,
        name: recipient.name,
        filename,
        path: path.join(folderPath, filename),
        confidence
      });
      usedFiles.add(filename);
    } else {
      unmatched.push(recipient);
    }
  }

  const unmatched_files = files.filter((f) => !usedFiles.has(f));
  return { matched, unmatched, unmatched_files, ai_errors: aiErrors };
}
