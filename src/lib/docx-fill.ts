import JSZip from 'jszip';
import path from 'path';
import fs from 'fs/promises';
import type { PublicFormItem, FormSubmissionItem } from './local-data';

const TEMPLATE_PATH = path.join(process.cwd(), 'src', 'lib', 'templates', 'feedback-form-fill-template.docx');

/**
 * Maps each Feedback Form Template field (matched by its exact label, since
 * a field's id is regenerated fresh every time the template is applied) onto
 * the token(s) inserted into feedback-form-fill-template.docx. Keep this in
 * sync with FEEDBACK_FORM_TEMPLATE_ID's fields in local-data.ts and with the
 * token names baked into the .docx itself.
 */
type FieldFillKind =
  | { kind: 'text'; token: string }
  | { kind: 'text2line'; token1: string } // long-answer: full text on line 1, line 2 stays blank
  | { kind: 'scale'; tokenPrefix: string } // {{prefix_1}}..{{prefix_5}}, one flips to checked
  | { kind: 'checkbox'; token: string }
  | { kind: 'yesno'; yesToken: string; noToken: string }
  | { kind: 'eventtype'; tokenMap: Record<string, string> };

const FIELD_FILL_MAP: Record<string, FieldFillKind> = {
  'Name of Event': { kind: 'text', token: 'event_name' },
  'Type of Event': {
    kind: 'eventtype',
    tokenMap: {
      MDP: 'event_type_mdp',
      FDP: 'event_type_fdp',
      Workshop: 'event_type_workshop',
      'Guest Lecture': 'event_type_guestlecture',
      'Seminar/Conference': 'event_type_seminar',
      Other: 'event_type_other',
    },
  },
  Date: { kind: 'text', token: 'date' },
  Duration: { kind: 'text', token: 'duration' },
  'Resource Person(s)': { kind: 'text', token: 'resource_persons' },
  'Participant Name': { kind: 'text', token: 'participant_name' },
  'Designation/Program/Semester': { kind: 'text', token: 'designation' },
  Department: { kind: 'text', token: 'department' },
  'Relevance of the topic': { kind: 'scale', tokenPrefix: 'rate_relevance' },
  'Clarity of objectives': { kind: 'scale', tokenPrefix: 'rate_clarity' },
  'Content quality & depth': { kind: 'scale', tokenPrefix: 'rate_content' },
  'Practical applicability': { kind: 'scale', tokenPrefix: 'rate_practical' },
  'Effectiveness of resource person': { kind: 'scale', tokenPrefix: 'rate_effectiveness' },
  'Use of tools/technology': { kind: 'scale', tokenPrefix: 'rate_tools' },
  'Interaction & engagement': { kind: 'scale', tokenPrefix: 'rate_interaction' },
  'Organization & coordination': { kind: 'scale', tokenPrefix: 'rate_organization' },
  'Overall satisfaction': { kind: 'scale', tokenPrefix: 'rate_overall' },
  'Understand key concepts clearly': { kind: 'checkbox', token: 'lo_understand' },
  'Apply learning in practical/academic context': { kind: 'checkbox', token: 'lo_apply' },
  'Use relevant tools/techniques introduced': { kind: 'checkbox', token: 'lo_tools' },
  'Enhance problem-solving/decision-making ability': { kind: 'checkbox', token: 'lo_problemsolving' },
  'Relate concepts to industry practices': { kind: 'checkbox', token: 'lo_industry' },
  'Key Takeaways from the Session': { kind: 'text2line', token1: 'takeaways_1' },
  'Most Valuable Aspect of the Event': { kind: 'text2line', token1: 'valuable_1' },
  'Suggestions for Improvement': { kind: 'text2line', token1: 'suggestions_1' },
  'Topics you would like in future sessions': { kind: 'text2line', token1: 'future_topics_1' },
  'Did the event enhance your knowledge/skills?': { kind: 'yesno', yesToken: 'enhance_yes', noToken: 'enhance_no' },
  'Will you apply the learning in future?': { kind: 'yesno', yesToken: 'apply_yes', noToken: 'apply_no' },
  'Overall Rating (Out of 5)': { kind: 'text', token: 'overall_rating' },
};

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Every token the fill-template contains, defaulted to its "blank" state
 *  (empty text / unchecked box) before any submission data is applied. */
function buildDefaultTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};

  const textTokens = [
    'event_name', 'date', 'duration', 'resource_persons', 'participant_name', 'designation', 'department',
    'overall_rating', 'takeaways_1', 'takeaways_2', 'valuable_1', 'valuable_2', 'suggestions_1', 'suggestions_2',
    'future_topics_1', 'future_topics_2',
  ];
  textTokens.forEach(t => { tokens[t] = ''; });

  const checkboxTokens = [
    'event_type_mdp', 'event_type_fdp', 'event_type_workshop', 'event_type_guestlecture', 'event_type_seminar', 'event_type_other',
    'lo_understand', 'lo_apply', 'lo_tools', 'lo_problemsolving', 'lo_industry',
    'enhance_yes', 'enhance_no', 'apply_yes', 'apply_no',
  ];
  checkboxTokens.forEach(t => { tokens[t] = '☐'; });

  const rateBases = [
    'rate_relevance', 'rate_clarity', 'rate_content', 'rate_practical', 'rate_effectiveness',
    'rate_tools', 'rate_interaction', 'rate_organization', 'rate_overall',
  ];
  rateBases.forEach(base => {
    for (let i = 1; i <= 5; i++) tokens[`${base}_${i}`] = '☐';
  });

  return tokens;
}

/**
 * Fills the Feedback Form Template's Word document with one submission's
 * answers and returns the resulting .docx as a Buffer. Never touches the
 * pristine uploaded original or mutates the on-disk fill-template — only
 * the in-memory copy loaded here.
 */
export async function fillFeedbackFormDocx(form: PublicFormItem, submission: FormSubmissionItem): Promise<Buffer> {
  const templateBuf = await fs.readFile(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuf);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) throw new Error('Feedback form fill-template is missing word/document.xml.');
  let xml = await xmlFile.async('string');

  const tokens = buildDefaultTokens();

  for (const field of form.fields) {
    const mapping = FIELD_FILL_MAP[field.label];
    if (!mapping) continue;
    const raw = submission.data[field.id];
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw) && raw.length === 0) continue;

    switch (mapping.kind) {
      case 'text':
        tokens[mapping.token] = escapeXml(String(raw));
        break;
      case 'text2line':
        // The full answer goes on the first blank line; the second stays
        // empty — Word wraps long running text on its own, so nothing is lost.
        tokens[mapping.token1] = escapeXml(String(raw));
        break;
      case 'scale': {
        const n = Math.round(Number(raw));
        if (n >= 1 && n <= 5) tokens[`${mapping.tokenPrefix}_${n}`] = '☒';
        break;
      }
      case 'checkbox': {
        // The Learning Outcomes fields used to be plain boolean checkboxes;
        // they're now a Yes/No select (see FEEDBACK_FORM_TEMPLATE_ID in
        // local-data.ts), so 'raw' arrives as the string "Yes"/"No" — keep
        // accepting the old boolean-ish values too for any already-submitted
        // responses recorded before that change.
        const v = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
        if (v === true || v === 'true' || v === 'yes' || v === 'on' || v === '1' || v === 1) tokens[mapping.token] = '☒';
        break;
      }
      case 'yesno': {
        const v = String(raw).trim().toLowerCase();
        if (v === 'yes') tokens[mapping.yesToken] = '☒';
        else if (v === 'no') tokens[mapping.noToken] = '☒';
        break;
      }
      case 'eventtype': {
        // "Type of Event" is a multiselect on the form (the original Word
        // document gives each type its own tick-box, so more than one can
        // legitimately apply — e.g. a Workshop that's also a Guest
        // Lecture) — tick every box the respondent selected, not just one.
        const selectedTypes = Array.isArray(raw) ? raw : [raw];
        for (const val of selectedTypes) {
          const t = mapping.tokenMap[String(val)];
          if (t) tokens[t] = '☒';
        }
        break;
      }
    }
  }

  for (const [key, value] of Object.entries(tokens)) {
    xml = xml.replaceAll(`{{${key}}}`, value);
  }

  zip.file('word/document.xml', xml);
  const out = await zip.generateAsync({ type: 'nodebuffer' });
  return out;
}
