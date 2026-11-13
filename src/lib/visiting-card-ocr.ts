import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createWorker, type Worker } from 'tesseract.js';

const execFileAsync = promisify(execFile);

const OCR_CACHE_DIR = path.join(process.cwd(), 'data', 'ocr-cache');

let workerPromise: Promise<Worker> | null = null;
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', undefined, {
      cachePath: OCR_CACHE_DIR,
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export interface ExtractedCardDetails {
  name: string;
  organization: string;
  designation: string;
  phone: string;       // Primary Mobile Number
  telephone?: string;   // Secondary / Telephone / Landline Number
  email: string;
  website: string;
  address: string;
  linkedin: string;
  notes: string;
  rawText: string;
}

const DESIGNATION_KEYWORDS = [
  'director', 'managing director', 'md', 'exec director', 'executive director',
  'ceo', 'cto', 'cfo', 'coo', 'cio', 'cmo', 'cro', 'cpo', 'president', 'vice president', 'vp', 'avp',
  'manager', 'general manager', 'gm', 'dgm', 'agm', 'senior manager', 'sr manager', 'branch manager', 'area manager', 'regional manager', 'project manager', 'operations manager', 'sales manager', 'marketing manager',
  'consultant', 'engineer', 'developer', 'specialist', 'lead', 'team lead', 'head', 'head of', 'chief', 'chief executive',
  'architect', 'designer', 'analyst', 'professor', 'prof', 'dean', 'principal',
  'trustee', 'chairman', 'chairperson', 'secretary', 'advisor', 'partner', 'associate partner',
  'associate', 'coordinator', 'registrar', 'chancellor', 'superintendent', 'administrator', 'hod',
  'proprietor', 'owner', 'founder', 'co-founder'
];

const ORG_MARKERS = [
  'pvt', 'ltd', 'limited', 'inc', 'incorporated', 'corp', 'corporation',
  'company', 'technologies', 'tech', 'solutions', 'services', 'group',
  'systems', 'enterprise', 'enterprises', 'labs', 'laboratory', 'studio',
  'university', 'institute', 'college', 'foundation', 'agency', 'ventures',
  'industries', 'global', 'software', 'pvt.', 'ltd.', 'inc.', 'co.', 'hospital',
  'clinic', 'school', 'academy', 'trust', 'society', 'council', 'federation',
  'chamber', 'commerce', 'confederation', 'authority', 'board', 'union',
];

const INDUSTRY_KEYWORDS = [
  'pump', 'oil', 'gas', 'petroleum', 'steel', 'auto', 'automotive', 'motors',
  'electronics', 'electricals', 'pharma', 'pharmaceuticals', 'logistics', 'textiles',
  'exports', 'imports', 'chemicals', 'trading', 'traders', 'engineering', 'engineers',
  'infra', 'infrastructure', 'construction', 'builders', 'developers', 'media',
  'foods', 'beverages', 'retail', 'retails', 'store', 'shop', 'hotel', 'resort',
  'hospital', 'healthcare', 'bank', 'finance', 'financial', 'investments', 'capital',
  'holdings', 'security', 'energy', 'power', 'realty', 'real estate', 'consultancy',
  'solutions', 'technologies', 'software', 'networks', 'communications', 'digital'
];

const HONORIFICS = [
  'dr.', 'dr', 'mr.', 'mr', 'mrs.', 'mrs', 'ms.', 'ms', 'prof.', 'prof', 'pro.', 'pro',
  'eng.', 'engr.', 'er.', 'er', 'adv.', 'adv', 'shri', 'smt.', 'smt', 'ca', 'cs',
  'capt.', 'col.', 'maj.', 'sir'
];

/**
 * Academic/organizational-unit phrases ("Department of Economics", "School
 * of Management") — never a person's name, but without an explicit penalty
 * one could still out-score the real name candidate on a faculty card: it's
 * a clean 2-4 word, letters-only line that often sits right next to the
 * Designation line (the same physical adjacency the real name gets credit
 * for), while a name prefixed with a less common honorific like "Pro:"
 * (a common abbreviation for Professor) picks up fewer of the other bonuses.
 */
const DEPARTMENT_MARKERS = [
  'department of', 'dept of', 'dept.', 'faculty of', 'school of',
  'division of', 'centre for', 'center for', 'institute of',
];

// Address vocabulary split by how conclusive a match is. STRONG entries are
// street/building/layout terms that essentially never appear outside a
// physical address, so a match on their own is enough to definitively
// classify a line as address text. WEAK entries are bare city/state/country
// names — real address signals, but also common inside legitimate
// organization names ("Bangalore Chamber of Industry and Commerce", "Delhi
// Public School", "Mumbai Indians"), so a weak match alone must never
// override an otherwise-plausible organization candidate, and never
// disqualifies a line from being definitively classified as an address in
// Pass A — only a strong keyword or a pincode does that.
const STRONG_ADDRESS_KEYWORDS = [
  'road', 'rd', 'street', 'st', 'avenue', 'ave', 'block', 'sector',
  'floor', 'suite', 'building', 'complex', 'area', 'nagar', 'layout',
  'district', 'pincode', 'pin', 'zip',
];
const WEAK_ADDRESS_KEYWORDS = [
  'city', 'state', 'india',
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'chennai',
  'kolkata', 'pune', 'ahmedabad', 'gurgaon', 'noida', 'karnataka', 'maharashtra'
];
const ADDRESS_KEYWORDS = [...STRONG_ADDRESS_KEYWORDS, ...WEAK_ADDRESS_KEYWORDS];

/** Strip OCR symbols and noise characters from boundaries of string */
function cleanOcrLine(line: string): string {
  return line.replace(/^[;>=+|~*^<>:_#,\-\s\.]+|[;>=+|~*^<>:_#,\-\s\.]+$/g, '').trim();
}

/** Returns true if a text line is OCR noise, background artifact, or gibberish */
function isGibberishLine(line: string): boolean {
  const cleaned = cleanOcrLine(line);
  if (cleaned.length < 2) return true;

  // Alphanumeric ratio check (at least 45% must be valid letters/numbers)
  const alphaNumCount = (cleaned.match(/[a-zA-Z0-9]/g) || []).length;
  if (alphaNumCount / cleaned.length < 0.45) return true;

  // Excessive symbol density check
  const symbolCount = (cleaned.match(/[;>=+|~*^<>:_]/g) || []).length;
  if (symbolCount > 2 || symbolCount / cleaned.length > 0.2) return true;

  // Short nonsensical token ratio check (e.g. "a A Ee Be ee ST")
  const tokens = cleaned.split(/\s+/);
  const shortNonsense = tokens.filter(
    (t) => t.length <= 2 && !/^(rd|st|nd|th|in|no|of|to|co|dr|mr|ms|vp|ph|m:|t:)$/i.test(t)
  );
  if (tokens.length >= 3 && shortNonsense.length / tokens.length >= 0.5) return true;

  // Generic OCR noise patterns
  if (/^[a-z0-9]{1,3}\s+[a-z0-9]{1,3}\s+[a-z0-9]{1,3}$/i.test(cleaned)) return true;
  if (/^(sre|gion|sis see|eed byes|nzpindia|strrettess|etl)$/i.test(cleaned)) return true;

  return false;
}

/** Normalize string by keeping only lowercase alphanumeric characters for fuzzy duplicate checking */
function normalizeForComparison(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Word-boundary match against ADDRESS_KEYWORDS. Short entries like "st",
 * "rd", "pin", and "ave" are common English/Indian address abbreviations,
 * but as a plain substring check they also match inside completely
 * unrelated words — "st" inside "Industries", "rd" inside "award", "pin"
 * inside "opinion" — which used to misclassify organization/name lines as
 * address text and swallow them into the address field. \b anchors each
 * keyword to a real word boundary the same way ORG_MARKERS/INDUSTRY_KEYWORDS
 * already do.
 */
function matchesAddressKeyword(text: string): boolean {
  return ADDRESS_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(text));
}

/**
 * Word-boundary match against STRONG_ADDRESS_KEYWORDS only — street/layout
 * terms with no legitimate reading outside a physical address. Used
 * wherever a match needs to be conclusive on its own: definitively routing
 * a line into the address field in Pass A, and penalizing a line's chances
 * of being the organization name. A bare city/state name is deliberately
 * excluded from both of those — "Bangalore Chamber of Industry and
 * Commerce" is a real organization name, not an address line, even though
 * it starts with a city name.
 */
function matchesStrongAddressKeyword(text: string): boolean {
  return STRONG_ADDRESS_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(text));
}

/** Checks if candidate line is a duplicate or part of an extracted main field */
function isDuplicateOfField(line: string, field: string): boolean {
  if (!line || !field) return false;
  const normLine = normalizeForComparison(line);
  const normField = normalizeForComparison(field);
  if (!normLine || !normField) return false;

  return normLine === normField || normLine.includes(normField) || normField.includes(normLine);
}

/** Direct execution of native C++ Tesseract engine with multi-PSM & native character whitelist */
async function tryNativeTesseractOcr(imageBuffer: Buffer): Promise<string | null> {
  const tmpDir = os.tmpdir();
  const randSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const inputPath = path.join(tmpDir, `card_ocr_in_${randSuffix}.png`);
  const outputPathBase = path.join(tmpDir, `card_ocr_out_${randSuffix}`);

  try {
    await fs.writeFile(inputPath, imageBuffer);

    let resultText = '';

    // Pass 1: Native C++ Tesseract with PSM 11 (Sparse Text - best for business cards & scattered text)
    try {
      await execFileAsync('tesseract', [
        inputPath,
        outputPathBase + '_psm11',
        '--psm', '11',
        '-c', 'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,@:+-()/&# '
      ]);
      const txt11 = await fs.readFile(outputPathBase + '_psm11.txt', 'utf-8');
      resultText += '\n' + txt11;
    } catch (e) {}

    // Pass 2: Native C++ Tesseract with PSM 6 (Uniform Block Text)
    try {
      await execFileAsync('tesseract', [
        inputPath,
        outputPathBase + '_psm6',
        '--psm', '6',
      ]);
      const txt6 = await fs.readFile(outputPathBase + '_psm6.txt', 'utf-8');
      resultText += '\n' + txt6;
    } catch (e) {}

    // Clean up temporary files
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPathBase + '_psm11.txt').catch(() => {});
    await fs.unlink(outputPathBase + '_psm6.txt').catch(() => {});

    return resultText.trim() || null;
  } catch (err) {
    await fs.unlink(inputPath).catch(() => {});
    return null;
  }
}

/**
 * True if `lower` starts with one of the HONORIFICS immediately followed by
 * a non-letter (colon, period, space, or end of string) — a plain
 * `.startsWith()` would also match "pro" inside "Product Manager" or
 * "Project Lead", which are designations, not honorific-prefixed names.
 */
function startsWithHonorific(lower: string): boolean {
  return HONORIFICS.some((h) => {
    if (!lower.startsWith(h)) return false;
    const nextChar = lower[h.length];
    return !nextChar || !/[a-z]/i.test(nextChar);
  });
}

/** Computes a score evaluating how likely a line is to be the Person's Name */
function scoreNameCandidate(line: string, lineIndex: number, lines: string[], designationIndices: number[]): number {
  const lower = line.toLowerCase();
  // Strips a leading honorific before scoring word count / letters-only, so
  // "Pro: Ravi Bhanari" is judged as the 2-word name "Ravi Bhanari" rather
  // than penalized for the ":" that OCR (and some card layouts) place right
  // after an abbreviated honorific like "Pro" (for Professor) or "Dr".
  const cleaned = line.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?|prof\.?|pro\.?|eng\.?|er\.?|adv\.?|shri|smt\.?|ca|cs)\s*:?\s+/i, '').trim();

  // Hard Rejections
  if (/@|www|\.com|\.in|http/i.test(line)) return -500;
  if (/\d/.test(line)) return -500;
  if (/visiting card|business card|identity card|card|front of card|back of card/i.test(lower)) return -500;

  // Org markers or industry words penalize Name score heavily
  if (ORG_MARKERS.some((m) => new RegExp(`\\b${m}\\b`, 'i').test(lower))) return -500;
  if (matchesAddressKeyword(lower)) return -500;
  if (INDUSTRY_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(lower))) return -150;
  // "Department of X" / "School of Y" etc. — an organizational unit, never
  // a person's name, even though it's often a clean 2-4 word letters-only
  // line sitting right next to the Designation line just like a real name.
  if (DEPARTMENT_MARKERS.some((m) => new RegExp(`\\b${m}\\b`, 'i').test(lower))) return -400;

  let score = 0;
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);

  // Word count scoring
  if (words.length >= 2 && words.length <= 3) {
    score += 50;
  } else if (words.length === 1 || words.length === 4) {
    score += 25;
  } else {
    return -200;
  }

  // Honorific Bonus
  if (startsWithHonorific(lower)) {
    score += 100;
  }

  // Letters-only check
  if (words.every((w) => /^[A-Za-z.'-]+$/.test(w) || /^[A-Z]\.$/.test(w))) {
    score += 30;
  }

  // Proximity to Designation bonus (Name is usually right above or right below Designation)
  for (const desigIdx of designationIndices) {
    if (Math.abs(lineIndex - desigIdx) === 1) {
      score += 60;
    } else if (Math.abs(lineIndex - desigIdx) === 2) {
      score += 30;
    }
  }

  // Early placement bonus (Top 5 lines)
  if (lineIndex <= 4) {
    score += 20;
  }

  return score;
}

/** Computes a score evaluating how likely a line is to be the Organization / Company Name */
function scoreOrgCandidate(line: string, lineIndex: number): number {
  const lower = line.toLowerCase();
  if (/@|www|\.com|\.in|http/i.test(line)) return -500;
  if (/visiting card|business card|identity card|card/i.test(lower)) return -500;

  let score = 0;

  if (ORG_MARKERS.some((marker) => new RegExp(`\\b${marker}\\b`, 'i').test(lower))) {
    score += 150;
  }

  if (INDUSTRY_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(lower))) {
    score += 90;
  }

  // Only a strong (street/building) keyword counts against a line being the
  // organization — a bare city name doesn't, since plenty of real
  // organizations are named after their city ("Bangalore Chamber of
  // Industry and Commerce").
  if (matchesStrongAddressKeyword(lower)) {
    score -= 100;
  }

  if (lineIndex <= 3) {
    score += 20;
  }

  return score;
}

/** Format-agnostic semantic parser for arbitrary visiting card layouts */
export function parseVisitingCardText(rawText: string): ExtractedCardDetails {
  const rawLines = rawText
    .split('\n')
    .map((l) => cleanOcrLine(l))
    .filter((l) => l.length > 0);

  // Filter out gibberish noise lines
  const withoutGibberish = rawLines.filter((l) => !isGibberishLine(l));

  // performCardOcr runs OCR on both a "normal" and an "inverted" version of
  // every card image (dark-theme cards need the opposite of what light-theme
  // cards need, and the auto-detection guesses which is which) and
  // concatenates both full results as a robustness measure — first the
  // entire "normal" pass, then the entire "inverted" pass appended after it,
  // not interleaved. For the common case where the first guess was already
  // correct, this means every real line of text on the card appears twice,
  // far apart in the list, which used to double-count in name/org scoring
  // and left every address/notes line literally repeated in the output.
  // Drop later exact repeats (once punctuation/case/whitespace differences
  // are ignored), keeping only each line's first occurrence. This only ever
  // removes lines that are identical after normalization, so two distinct
  // lines that merely share a value (e.g. a phone number listed once under
  // "Mobile:" and again under "WhatsApp:") are never affected — only a
  // literal repeat of the very same line is.
  const seenNormalized = new Set<string>();
  const lines: string[] = [];
  for (const line of withoutGibberish) {
    const key = normalizeForComparison(line);
    if (key && seenNormalized.has(key)) continue;
    if (key) seenNormalized.add(key);
    lines.push(line);
  }

  let email = '';
  let website = '';
  let linkedin = '';
  let phone = '';
  let telephone = '';

  // 1. Extract Email. Tesseract routinely misreads the tight kerning right
  // after a '.' in an email local-part as a real space (e.g. "rajesh.
  // kumar@domain.com"), which used to truncate the match to just
  // "kumar@domain.com" since the regex doesn't span whitespace. Re-join a
  // single stray space between a dot and the next token only when that next
  // token leads into an "@" — never touches genuine sentence text elsewhere
  // in the raw OCR text used for other fields.
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const textForEmailMatch = rawText.replace(/([a-zA-Z0-9._%+-]+)\.\s+([a-zA-Z0-9._%+-]+@)/g, '$1.$2');
  const emailMatch = textForEmailMatch.match(emailRegex);
  if (emailMatch && emailMatch.length > 0) {
    email = emailMatch[0].toLowerCase()
      .replace(/gmai1\.com$/i, 'gmail.com')
      .replace(/gmaiI\.com$/i, 'gmail.com')
      .replace(/yaoo\.com$/i, 'yahoo.com')
      .replace(/outl0ok\.com$/i, 'outlook.com');
  }

  // 2. Extract LinkedIn
  const linkedinRegex = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi;
  const linkedinMatch = rawText.match(linkedinRegex);
  if (linkedinMatch && linkedinMatch.length > 0) {
    linkedin = linkedinMatch[0];
  }

  // 3. Extract Website
  const websiteRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi;
  const webMatches = rawText.match(websiteRegex) || [];
  for (const match of webMatches) {
    if (match.toLowerCase().includes('@') || match.toLowerCase().includes('linkedin.com')) continue;
    if (/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.(com|org|net|in|co|io|ai|edu|gov|ac\.in|co\.in|org\.in)$/i.test(match) || match.startsWith('www.')) {
      website = match;
      break;
    }
  }

  // 4. Extract Phone & Telephone numbers
  const phoneRegex = /(?:\+?91[\s.-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}|\b[6789]\d{9}\b|\b0\d{2,4}[\s.-]?\d{6,8}\b/g;
  const phoneMatches = Array.from(new Set(rawText.match(phoneRegex) || []));

  const validNumbers: string[] = [];
  for (const p of phoneMatches) {
    const digits = p.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 13) {
      validNumbers.push(p.trim());
    }
  }

  for (const num of validNumbers) {
    const digits = num.replace(/\D/g, '');
    const cleanDigits = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;

    const isLandline = cleanDigits.startsWith('0') || /^(080|022|011|044|033|040|079|0124|0120)/.test(num) || /tel|landline|ph|t:/i.test(num);
    const isMobile = /^[6789]/.test(cleanDigits) || /mob|cell|m:/i.test(num);

    if (isMobile && !phone) {
      phone = num;
    } else if (isLandline && !telephone) {
      telephone = num;
    } else if (!phone) {
      phone = num;
    } else if (!telephone && num !== phone) {
      telephone = num;
    }
  }

  let name = '';
  let designation = '';
  let organization = '';
  const addressLines: string[] = [];
  const designationIndices: number[] = [];

  // Pass A: Extract Address & Designation Lines, inline splits
  const nonAddressLines: { line: string; originalIndex: number }[] = [];

  lines.forEach((line, index) => {
    const lower = line.toLowerCase();

    // Skip contact lines
    if (email && lower.includes(email)) return;
    if (website && lower.includes(website.toLowerCase())) return;
    if (linkedin && lower.includes(linkedin.toLowerCase())) return;
    // A phone/telephone number is already captured in its own field — without
    // this, a line like "M: 98765 43210" fell through to the Address Check
    // below, where its 5-digit groups (the conventional Indian mobile
    // spacing) matched the pincode heuristic and the whole number got
    // wrongly appended to the address instead.
    if (phone && line.includes(phone)) return;
    if (telephone && line.includes(telephone)) return;
    if (/^(tel|phone|mob|mobile|cell|fax|mail|email|web|website|site|address|location|add):/i.test(line)) {
      if (/^(address|location|add):/i.test(line)) {
        addressLines.push(line.replace(/^(address|location|add):/i, '').trim());
      }
      return;
    }

    // Split inline Name | Designation or Name - Designation — but never for
    // a line that already looks like an address. A comma is also the
    // standard separator in a multi-part Indian address ("No. 45,
    // Industrial Layout, Peenya,"), and without this guard a fragment like
    // "Industrial Layout" could get misread as a bare Name/Designation part,
    // silently dropping the whole address line instead of letting it reach
    // the Address Check below.
    const looksLikeAddress = /\b\d{3}[\s-]?\d{3}\b/.test(line) || matchesAddressKeyword(lower);
    if (!looksLikeAddress && /[|\-,\/]/.test(line)) {
      const parts = line.split(/[|\-,\/]/).map((p) => cleanOcrLine(p)).filter((p) => p.length > 0);
      let splitHandled = false;
      for (const part of parts) {
        const pLower = part.toLowerCase();
        if (!designation && DESIGNATION_KEYWORDS.some((kw) => pLower.includes(kw))) {
          designation = part;
          designationIndices.push(index);
          splitHandled = true;
        } else if (!name && /^[A-Za-z.'\s-]+$/.test(part) && part.split(/\s+/).length <= 4) {
          name = part;
          splitHandled = true;
        }
      }
      if (splitHandled) return;
    }

    // Designation Check
    if (!designation && DESIGNATION_KEYWORDS.some((kw) => lower.includes(kw))) {
      designation = line;
      designationIndices.push(index);
      return;
    }

    // Address Check. Indian PIN codes are always 6 digits, sometimes printed
    // as one contiguous run ("560058") and sometimes as two groups of 3
    // ("560 001" / "560-001") — matched either way, but a bare 5-digit run
    // is deliberately excluded since that's also how a phone number's
    // individual digit groups look in the conventional "98765 43210"
    // spacing (the phone/telephone skip above is the primary guard against
    // that; this stays narrow as a second line of defense). Only a STRONG
    // keyword definitively routes a line to the address field here — a bare
    // city/state name alone does not, since it's also common inside a real
    // organization's own name (see matchesStrongAddressKeyword).
    const hasPinCode = /\b\d{3}[\s-]?\d{3}\b/.test(line);
    const hasAddressKw = matchesStrongAddressKeyword(lower);
    if (hasPinCode || hasAddressKw) {
      addressLines.push(cleanOcrLine(line));
      return;
    }

    nonAddressLines.push({ line, originalIndex: index });
  });

  // Pass B: Score Name and Organization Candidates across remaining lines
  let bestNameCandidate = name;
  let bestNameScore = name ? 100 : 0;

  let bestOrgCandidate = organization;
  let bestOrgScore = organization ? 100 : 0;

  for (const { line, originalIndex } of nonAddressLines) {
    const nScore = scoreNameCandidate(line, originalIndex, lines, designationIndices);
    if (nScore > bestNameScore) {
      bestNameScore = nScore;
      bestNameCandidate = line;
    }

    const oScore = scoreOrgCandidate(line, originalIndex);
    if (oScore > bestOrgScore) {
      bestOrgScore = oScore;
      bestOrgCandidate = line;
    }
  }

  // A letterhead/logo often wraps its institution name across several short
  // stacked lines ("RAMAIAH" / "UNIVERSITY" / "OF APPLIED SCIENCES") — none
  // of which alone reads as the full name, so whichever fragment happens to
  // contain a strong ORG_MARKER wins by default even though it's incomplete.
  // Try joining a leading run of such fragments (short, no digits/@/colon,
  // strictly before the first name/designation line found) into one extra
  // candidate and re-score it — this only ever ADDS a candidate alongside
  // the individual lines above, so a card without this pattern is
  // unaffected (the run is empty or length 1, and the join is skipped).
  const firstMarkedIndex = Math.min(
    designationIndices.length > 0 ? Math.min(...designationIndices) : Infinity,
    nonAddressLines.length > 0
      ? nonAddressLines.reduce((min, { line: l, originalIndex: i }) =>
          i < min && startsWithHonorific(l.toLowerCase()) ? i : min, Infinity)
      : Infinity
  );
  const headerRun: string[] = [];
  for (const { line, originalIndex } of nonAddressLines) {
    if (originalIndex >= firstMarkedIndex) break;
    if (/[@:0-9]/.test(line)) break;
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    if (wordCount > 4) break;
    headerRun.push(line);
  }
  if (headerRun.length >= 2) {
    const merged = headerRun.join(' ');
    const mergedScore = scoreOrgCandidate(merged, nonAddressLines[0].originalIndex);
    // >= rather than > : the merged, more-complete name is presumptively at
    // least as good as any one of its own fragments already considered
    // above, so a tie (nothing else on the card scored higher either way)
    // should resolve in favor of the fuller string.
    if (mergedScore > 0 && mergedScore >= bestOrgScore) {
      bestOrgScore = mergedScore;
      bestOrgCandidate = merged;
    }
  }

  name = bestNameCandidate;
  organization = bestOrgCandidate;

  // Fallback: If organization is missing, pick the top remaining unassigned line
  if (!organization && nonAddressLines.length > 0) {
    for (const { line } of nonAddressLines) {
      if (line !== name && line !== designation && line.length > 2 && line.length < 60 && !isGibberishLine(line)) {
        organization = line;
        break;
      }
    }
  }

  const address = addressLines.join(', ');

  // Format-Agnostic Anti-Pollution Notes Filter
  const cleanUnused = lines.filter((l) => {
    if (isGibberishLine(l)) return false;
    if (isDuplicateOfField(l, name)) return false;
    if (isDuplicateOfField(l, designation)) return false;
    if (isDuplicateOfField(l, organization)) return false;
    if (isDuplicateOfField(l, address)) return false;
    if (isDuplicateOfField(l, email)) return false;
    if (isDuplicateOfField(l, website)) return false;
    if (isDuplicateOfField(l, phone)) return false;
    if (isDuplicateOfField(l, telephone || '')) return false;
    if (/visiting card|business card|identity card|card|front|back/i.test(l)) return false;
    return true;
  });

  const notes = cleanUnused.length > 0 ? cleanUnused.join('\n') : '';

  return {
    name: name.trim(),
    organization: organization.trim(),
    designation: designation.trim(),
    phone: phone.trim(),
    telephone: telephone.trim() || undefined,
    email: email.trim(),
    website: website.trim(),
    address: address.trim(),
    linkedin: linkedin.trim(),
    notes: notes.trim(),
    rawText: rawText.trim(),
  };
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 4).toString('utf-8') === '%PDF';
}

async function convertPdfToImageBuffers(pdfBuffer: Buffer): Promise<Buffer[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl: path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, 2);

  const pages: Buffer[] = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    // @ts-expect-error context type match for pdfjs-dist
    await page.render({ canvasContext: context, viewport }).promise;
    pages.push(canvas.encodeSync('png'));
  }

  await loadingTask.destroy();
  return pages;
}

/** Pre-process image buffer using Canvas: upscale to >= 1800px, boost contrast, and generate dark-card auto-inversion */
async function preprocessCardImageBuffer(inputBuffer: Buffer): Promise<{ normal: Buffer; inverted: Buffer }> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(inputBuffer);

  const minWidth = 1800;
  const scale = img.width < minWidth ? minWidth / img.width : 1;
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Calculate average luminance to detect dark-background cards
  let totalLuminance = 0;
  const numPixels = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const avgBrightness = totalLuminance / numPixels;
  const isDarkTheme = avgBrightness < 128;

  const normalCanvas = createCanvas(width, height);
  const normalCtx = normalCanvas.getContext('2d');
  const normalData = normalCtx.createImageData(width, height);

  const invertedCanvas = createCanvas(width, height);
  const invertedCtx = invertedCanvas.getContext('2d');
  const invertedData = invertedCtx.createImageData(width, height);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const contrasted = gray > 180 ? 255 : gray < 70 ? 0 : Math.round((gray - 70) * (255 / 110));

    normalData.data[i] = contrasted;
    normalData.data[i + 1] = contrasted;
    normalData.data[i + 2] = contrasted;
    normalData.data[i + 3] = a;

    const inv = 255 - contrasted;
    invertedData.data[i] = inv;
    invertedData.data[i + 1] = inv;
    invertedData.data[i + 2] = inv;
    invertedData.data[i + 3] = a;
  }

  normalCtx.putImageData(normalData, 0, 0);
  invertedCtx.putImageData(invertedData, 0, 0);

  return {
    normal: isDarkTheme ? invertedCanvas.encodeSync('png') : normalCanvas.encodeSync('png'),
    inverted: isDarkTheme ? normalCanvas.encodeSync('png') : invertedCanvas.encodeSync('png'),
  };
}

/** Format-Agnostic Multimodal Gemini Vision AI OCR execution */
async function tryGeminiVisionOcr(frontBuffer: Buffer, backBuffer?: Buffer): Promise<ExtractedCardDetails | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const parts: any[] = [
      {
        text: `You are an expert visiting card OCR and entity parsing AI system.
Analyze the visiting card image(s) provided (which may be horizontal, vertical, dark-themed, or complex layout) and extract details into structured JSON:
- "name": Full name of the person (including honorifics like Dr., Mr., etc.)
- "organization": Company, Organization, Institution, or University name
- "designation": Job title, role, or designation (e.g. "Managing Director", "Founder & CEO", "Sr. Vice President - Sales")
- "phone": Primary mobile phone number (formatted nicely, e.g. +91 98765 43210)
- "telephone": Landline, extension, or secondary phone number (if present, e.g. 080-23608000)
- "email": Primary email address
- "website": Website URL
- "address": Complete address (street, building, industrial area, city, pincode, state)
- "linkedin": LinkedIn URL or handle (if present)
- "notes": Any other clear text on the card (DO NOT include OCR noise, symbols, or duplicate fields)

Respond strictly with valid JSON inside a \`\`\`json block.`
      },
      {
        inline_data: {
          mime_type: isPdfBuffer(frontBuffer) ? 'application/pdf' : 'image/png',
          data: frontBuffer.toString('base64'),
        }
      }
    ];

    if (backBuffer) {
      parts.push({
        inline_data: {
          mime_type: isPdfBuffer(backBuffer) ? 'application/pdf' : 'image/png',
          data: backBuffer.toString('base64'),
        }
      });
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const textResp = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = textResp.match(/```json\s*([\s\S]*?)\s*```/) || textResp.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    return {
      name: (parsed.name || '').trim(),
      organization: (parsed.organization || '').trim(),
      designation: (parsed.designation || '').trim(),
      phone: (parsed.phone || '').trim(),
      telephone: (parsed.telephone || '').trim() || undefined,
      email: (parsed.email || '').trim(),
      website: (parsed.website || '').trim(),
      address: (parsed.address || '').trim(),
      linkedin: (parsed.linkedin || '').trim(),
      notes: (parsed.notes || '').trim(),
      rawText: textResp,
    };
  } catch (err) {
    console.warn('[Gemini Vision OCR] Error, falling back to local OCR:', err);
    return null;
  }
}

/** Server-side 3-tiered OCR execution for card image/PDF buffer(s) */
export async function performCardOcr(
  frontBuffer: Buffer,
  backBuffer?: Buffer
): Promise<ExtractedCardDetails> {
  // Tier 1: Try Gemini Multimodal AI Vision OCR if GEMINI_API_KEY is configured
  const geminiResult = await tryGeminiVisionOcr(frontBuffer, backBuffer);
  if (geminiResult && (geminiResult.name || geminiResult.email || geminiResult.phone || geminiResult.organization)) {
    return geminiResult;
  }

  // Pre-process input buffers
  let frontRawBuffers: Buffer[] = [];
  if (isPdfBuffer(frontBuffer)) {
    frontRawBuffers = await convertPdfToImageBuffers(frontBuffer);
  } else {
    frontRawBuffers = [frontBuffer];
  }

  let nativeCombinedText = '';
  // Tracks whether the native tesseract binary actually produced any text,
  // independent of nativeCombinedText's raw length. Without this, the
  // "--- BACK OF CARD ---" divider appended below (purely cosmetic, to
  // separate front/back text for the parser) was enough on its own to make
  // nativeCombinedText non-empty even when the native binary is missing
  // entirely (as it is wherever tesseract-ocr isn't installed system-wide) —
  // so every scan submitted with a back-of-card photo returned near-empty
  // garbage parsed from just that marker string, and Tier 3 (the WASM
  // engine, which actually works) was never even attempted.
  let nativeOcrFoundText = false;

  // Tier 2: Try Direct Native C++ Tesseract 5.5 Engine with PSM 11 + PSM 6
  for (const rawBuf of frontRawBuffers) {
    try {
      const { normal, inverted } = await preprocessCardImageBuffer(rawBuf);

      const normText = await tryNativeTesseractOcr(normal);
      if (normText) { nativeCombinedText += '\n' + normText; nativeOcrFoundText = true; }

      const invText = await tryNativeTesseractOcr(inverted);
      if (invText) { nativeCombinedText += '\n' + invText; nativeOcrFoundText = true; }
    } catch (e) {
      const rawText = await tryNativeTesseractOcr(rawBuf);
      if (rawText) { nativeCombinedText += '\n' + rawText; nativeOcrFoundText = true; }
    }
  }

  if (backBuffer) {
    let backRawBuffers: Buffer[] = [];
    if (isPdfBuffer(backBuffer)) {
      backRawBuffers = await convertPdfToImageBuffers(backBuffer);
    } else {
      backRawBuffers = [backBuffer];
    }
    nativeCombinedText += '\n--- BACK OF CARD ---\n';
    for (const rawBuf of backRawBuffers) {
      try {
        const { normal, inverted } = await preprocessCardImageBuffer(rawBuf);
        const normText = await tryNativeTesseractOcr(normal);
        if (normText) { nativeCombinedText += '\n' + normText; nativeOcrFoundText = true; }

        const invText = await tryNativeTesseractOcr(inverted);
        if (invText) { nativeCombinedText += '\n' + invText; nativeOcrFoundText = true; }
      } catch (e) {
        const rawText = await tryNativeTesseractOcr(rawBuf);
        if (rawText) { nativeCombinedText += '\n' + rawText; nativeOcrFoundText = true; }
      }
    }
  }

  // If native C++ engine produced results, parse and return immediately
  if (nativeOcrFoundText) {
    const parsedNative = parseVisitingCardText(nativeCombinedText);
    if (parsedNative.name || parsedNative.phone || parsedNative.email || parsedNative.organization) {
      return parsedNative;
    }
  }

  // Tier 3: WebAssembly tesseract.js Fallback if native engine binary is not present
  const worker = await getWorker();
  let wasmCombinedText = '';

  for (const rawBuf of frontRawBuffers) {
    try {
      const { normal, inverted } = await preprocessCardImageBuffer(rawBuf);

      const { data: normData } = await worker.recognize(normal);
      if (normData.text) wasmCombinedText += '\n' + normData.text;

      const { data: invData } = await worker.recognize(inverted);
      if (invData.text) wasmCombinedText += '\n' + invData.text;
    } catch (e) {
      const { data } = await worker.recognize(rawBuf);
      if (data.text) wasmCombinedText += '\n' + data.text;
    }
  }

  if (backBuffer) {
    let backRawBuffers: Buffer[] = [];
    if (isPdfBuffer(backBuffer)) {
      backRawBuffers = await convertPdfToImageBuffers(backBuffer);
    } else {
      backRawBuffers = [backBuffer];
    }
    wasmCombinedText += '\n--- BACK OF CARD ---\n';
    for (const rawBuf of backRawBuffers) {
      try {
        const { normal, inverted } = await preprocessCardImageBuffer(rawBuf);
        const { data: normData } = await worker.recognize(normal);
        if (normData.text) wasmCombinedText += '\n' + normData.text;

        const { data: invData } = await worker.recognize(inverted);
        if (invData.text) wasmCombinedText += '\n' + invData.text;
      } catch (e) {
        const { data } = await worker.recognize(rawBuf);
        if (data.text) wasmCombinedText += '\n' + data.text;
      }
    }
  }

  return parseVisitingCardText(wasmCombinedText);
}
