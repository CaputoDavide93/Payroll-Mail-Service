import fs from 'node:fs';
import { logInfo } from './logbus.js';
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
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').trim();
}

// Strip control chars and newlines to prevent prompt injection via employee names or filenames.
function sanitize(s) {
  return String(s).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200);
}

// Match a recipient name to a filename and grade the confidence:
//  - high:   the full name (2+ parts) appears intact in the filename, e.g.
//            "Thomas Alan Smith" -> "Thomas Alan Smith 25-26.pdf"
//  - medium: a single file contains all name parts but not as one run, or a
//            single-part (mononym) match
//  - low:    several files contain all the name parts (ambiguous)
// Returns { filename, confidence } or null.
export function fuzzyMatch(name, filenames, usedFiles) {
  const norm = normStr(name);
  const parts = norm.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const candidates = filenames.filter((f) => {
    if (usedFiles.has(f)) return false;
    const nf = normStr(f);
    return parts.every((p) => nf.includes(p));
  });
  if (candidates.length === 0) return null;
  // Prefer the shortest filename — fewest extra tokens beyond the name.
  candidates.sort((a, b) => a.length - b.length);
  const best = candidates[0];
  const fullNameIntact = normStr(best).includes(norm); // all parts, in order, contiguous

  let confidence;
  if (fullNameIntact && parts.length >= 2) confidence = 'high';
  else if (candidates.length === 1) confidence = 'medium';
  else confidence = 'low';
  return { filename: best, confidence };
}

const AI_TIMEOUT_MS = 30_000;
const AI_BATCH_SIZE = 25;     // recipients per AI call — keeps JSON output well under max_tokens
const AI_CONCURRENCY = 5;     // parallel AI calls in flight

// Match one batch of recipients against the full file list (single Claude call).
async function aiMatchBatch(recipients, filenames, apiKey) {
  const prompt = `You are matching payroll attachment files to employee recipients.

Recipients (JSON):
${JSON.stringify(recipients.map((r) => ({ email: sanitize(r.email), name: sanitize(r.name) })), null, 2)}

Available files:
${filenames.map((f, i) => `${i + 1}. ${sanitize(f)}`).join('\n')}

Match each recipient to their file. Be flexible: handle different separators (space, underscore, hyphen, dot), case differences, reversed name order (last first vs first last), accents, initials, and abbreviations.

Return ONLY a JSON array — no explanation, no markdown. Format:
[{"email":"...","filename":"...","confidence":"high|medium|low"}]

Only include recipients you matched. Skip unmatched ones.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('AI matching timed out')), AI_TIMEOUT_MS);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: controller.signal
  });
  clearTimeout(timer);

  if (!res.ok) {
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

// Batch recipients into parallel AI calls so large runs (150+) actually get AI coverage
// instead of overflowing a single call's token budget. All files are passed to every
// batch (a recipient's file can be any of them). Returns merged results + per-batch errors.
async function aiMatch(recipients, filenames, apiKey) {
  const batches = [];
  for (let i = 0; i < recipients.length; i += AI_BATCH_SIZE) {
    batches.push(recipients.slice(i, i + AI_BATCH_SIZE));
  }

  logInfo('match', `AI matching ${recipients.length} recipient(s) in ${batches.length} batch(es) of up to ${AI_BATCH_SIZE}…`);
  const results = [];
  const errors = [];
  for (let i = 0; i < batches.length; i += AI_CONCURRENCY) {
    const slice = batches.slice(i, i + AI_CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((b) => aiMatchBatch(b, filenames, apiKey))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
      else errors.push(r.reason?.message || String(r.reason));
    }
  }
  return { results, errors };
}

export async function matchAttachments(recipients, folderPath, apiKey) {
  if (!recipients || recipients.length === 0) throw new Error('Recipients list is empty.');
  const files = listAttachmentFiles(folderPath);
  if (files.length === 0) throw new Error(`No supported files found in ${folderPath}`);

  let aiResults = [];
  const aiErrors = [];

  if (apiKey) {
    const { results, errors } = await aiMatch(recipients, files, apiKey);
    aiResults = results;
    aiErrors.push(...errors);
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
      const fz = fuzzyMatch(recipient.name, files, usedFiles);
      if (fz) { filename = fz.filename; confidence = fz.confidence; }
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
