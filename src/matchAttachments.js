import fs from 'node:fs';
import path from 'node:path';

const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.png', '.jpg', '.jpeg']);

// List all supported attachment files in a directory.
export function listAttachmentFiles(folderPath) {
  if (!fs.existsSync(folderPath)) throw new Error(`Folder not found: ${folderPath}`);
  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${folderPath}`);
  return fs.readdirSync(folderPath)
    .filter((f) => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()))
    .sort();
}

// Fuzzy fallback: check if all name parts appear in the normalised filename.
function normStr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ').trim();
}

function fuzzyMatch(name, filenames) {
  const parts = normStr(name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const candidates = filenames.filter((f) => {
    const nf = normStr(f);
    return parts.every((p) => nf.includes(p));
  });
  if (candidates.length === 1) return candidates[0];
  // If multiple match, prefer shortest filename (most specific).
  if (candidates.length > 1) return candidates.sort((a, b) => a.length - b.length)[0];
  return null;
}

// AI matching via Claude API. Returns [{email, filename, confidence}].
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
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Extract JSON from the response (strip any accidental markdown fences).
  const jsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(jsonStr);
}

/**
 * Match recipients to files in folderPath.
 * Returns:
 *   matched          — [{email, name, filename, path, confidence}]
 *   unmatched        — recipients with no file found
 *   unmatched_files  — files that weren't claimed by any recipient
 */
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

  // Build a set of what AI matched (keyed by email).
  const aiMap = new Map(aiResults.map((r) => [r.email.toLowerCase(), r]));

  const matched = [];
  const unmatched = [];
  const usedFiles = new Set();

  for (const recipient of recipients) {
    const emailKey = recipient.email.toLowerCase();
    let filename = null;
    let confidence = 'low';

    // 1. Use AI result if available and file exists.
    const aiHit = aiMap.get(emailKey);
    if (aiHit && files.includes(aiHit.filename)) {
      filename = aiHit.filename;
      confidence = aiHit.confidence || 'high';
    }

    // 2. Fuzzy fallback for anything AI missed or if no API key.
    if (!filename) {
      filename = fuzzyMatch(recipient.name, files);
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
