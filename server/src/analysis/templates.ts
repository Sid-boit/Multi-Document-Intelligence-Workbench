import type { AnalysisPlan, AnalysisTemplate, ComparisonMode, PlanAttribute } from '@workbench/shared';

/**
 * Attribute library + the five built-in instruction templates.
 * Templates give a deterministic, instant analysis plan; custom instructions get an
 * LLM-generated plan (falling back to GENERIC_KEYS if that fails).
 */

const attr = (key: string, label: string, valueType: PlanAttribute['valueType'], required: boolean, synonyms: string[]): PlanAttribute => ({
  key,
  label,
  valueType,
  required,
  synonyms,
});

export const ATTRIBUTE_LIBRARY: Record<string, PlanAttribute> = {
  applicant_name: attr('applicant_name', 'Applicant name', 'person_name', true, [
    'applicant name', 'applicant', 'name of applicant', 'applicant full name', 'full name', 'director', 'director name',
  ]),
  company_name: attr('company_name', 'Company name', 'organisation', true, [
    'company name', 'company', 'business name', 'organisation', 'organisation name', 'licence holder', 'licensee', 'account name', 'client',
  ]),
  company_number: attr('company_number', 'Company number', 'identifier', false, [
    'company number', 'company no', 'company registration number', 'registration number', 'reg no', 'crn',
  ]),
  address: attr('address', 'Business address', 'address', true, [
    'address', 'business address', 'registered address', 'registered office', 'trading address', 'premises address', 'premises',
    'registered premises',
  ]),
  licence_number: attr('licence_number', 'Licence number', 'identifier', true, [
    'licence number', 'license number', 'licence no', 'license no', 'licence reference', 'licence ref', 'existing licence number',
  ]),
  annual_revenue: attr('annual_revenue', 'Annual revenue', 'money', true, [
    'annual revenue', 'declared annual revenue', 'revenue', 'turnover', 'annual turnover', 'declared turnover', 'sales',
  ]),
  net_profit: attr('net_profit', 'Net profit', 'money', false, ['net profit', 'profit', 'profit after tax', 'net income']),
  total_assets: attr('total_assets', 'Total assets', 'money', false, ['total assets', 'assets']),
  total_liabilities: attr('total_liabilities', 'Total liabilities', 'money', false, ['total liabilities', 'liabilities']),
  application_date: attr('application_date', 'Application date', 'date', false, ['application date', 'date of application', 'date submitted', 'submitted']),
  licence_issue_date: attr('licence_issue_date', 'Licence issue date', 'date', false, ['issue date', 'date of issue', 'issued', 'issued on']),
  licence_expiry: attr('licence_expiry', 'Licence expiry date', 'date', true, ['expiry date', 'expiry', 'expires', 'expires on', 'valid until', 'licence expiry']),
  signature_date: attr('signature_date', 'Signature date', 'date', true, ['signature date', 'date signed', 'signed on']),
  financial_year: attr('financial_year', 'Financial year', 'text', false, ['financial year', 'year', 'fy', 'period']),
};

const GENERIC_KEYS = [
  'applicant_name', 'company_name', 'company_number', 'address', 'licence_number',
  'annual_revenue', 'application_date', 'licence_expiry', 'signature_date',
];

interface TemplateDef extends AnalysisTemplate {
  keys: string[];
  /** Defaults to 'consistency'. */
  mode?: ComparisonMode;
}

const TEMPLATE_DEFS: TemplateDef[] = [
  {
    id: 'compare_all',
    label: 'Compare all documents',
    instruction: 'Compare the information across all uploaded documents.',
    keys: [...GENERIC_KEYS, 'licence_issue_date'],
  },
  {
    id: 'form_vs_supporting',
    label: 'Form vs supporting docs',
    instruction: 'Identify inconsistencies between the application form and supporting documents.',
    keys: GENERIC_KEYS,
  },
  {
    id: 'key_dates_financials',
    label: 'Dates, money & gaps',
    instruction: 'Extract key dates, obligations, financial values, and missing information.',
    keys: ['application_date', 'licence_issue_date', 'licence_expiry', 'signature_date', 'annual_revenue', 'net_profit', 'total_assets', 'total_liabilities'],
  },
  {
    id: 'financial_position',
    label: 'Financial position',
    instruction: 'Compare the financial position of the companies represented in the documents.',
    keys: ['company_name', 'financial_year', 'annual_revenue', 'net_profit', 'total_assets', 'total_liabilities'],
    mode: 'side_by_side', // the documents describe different companies
  },
  {
    id: 'identity_discrepancies',
    label: 'Names, addresses, licences, revenue',
    instruction: 'Highlight discrepancies in names, addresses, licence details, or revenue figures.',
    keys: ['applicant_name', 'company_name', 'address', 'licence_number', 'licence_expiry', 'annual_revenue'],
  },
];

export const TEMPLATES: AnalysisTemplate[] = TEMPLATE_DEFS.map(({ id, label, instruction }) => ({ id, label, instruction }));

function attributesFor(keys: string[]): PlanAttribute[] {
  return keys.map((k) => {
    const a = ATTRIBUTE_LIBRARY[k];
    if (!a) throw new Error(`Unknown attribute ${k}`);
    return a;
  });
}

export function templatePlan(templateId: string): AnalysisPlan | null {
  const def = TEMPLATE_DEFS.find((t) => t.id === templateId);
  return def ? { source: 'template', templateId: def.id, comparisonMode: def.mode ?? 'consistency', attributes: attributesFor(def.keys) } : null;
}

/** Templates match on id, or on the exact instruction text (user clicked a chip but no id was sent). */
export function findTemplateId(instruction: string, templateId?: string | null): string | null {
  if (templateId && TEMPLATE_DEFS.some((t) => t.id === templateId)) return templateId;
  const norm = instruction.trim().toLowerCase();
  return TEMPLATE_DEFS.find((t) => t.instruction.toLowerCase() === norm)?.id ?? null;
}

export function fallbackPlan(): AnalysisPlan {
  return { source: 'fallback', templateId: null, comparisonMode: 'consistency', attributes: attributesFor(GENERIC_KEYS) };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Find the library attribute an LLM-proposed attribute corresponds to (by key, label or synonym). */
function libraryMatch(a: Pick<PlanAttribute, 'key' | 'label'>): PlanAttribute | undefined {
  if (ATTRIBUTE_LIBRARY[a.key]) return ATTRIBUTE_LIBRARY[a.key];
  const candidates = [norm(a.key), norm(a.label)];
  return Object.values(ATTRIBUTE_LIBRARY).find((lib) =>
    [lib.key, lib.label, ...lib.synonyms].map(norm).some((s) => s.includes(' ') && candidates.includes(s)),
  );
}

/** Infer a better value type than "text" from the attribute's name. */
export function inferValueType(a: Pick<PlanAttribute, 'key' | 'label' | 'valueType'>): PlanAttribute['valueType'] {
  if (a.valueType !== 'text') return a.valueType;
  const k = norm(`${a.key} ${a.label}`);
  if (/\baddress|premises\b/.test(k)) return 'address';
  if (/\b(date|expiry|expires|deadline|due)\b/.test(k)) return 'date';
  if (/\b(revenue|turnover|profit|assets|liabilities|amount|income|balance|price|cost|fee)\b/.test(k)) return 'money';
  if (/\b(number|no|ref|reference|id|identifier|code)\b/.test(k)) return 'identifier';
  if (/\b(company|business|organisation|organization|licensee|holder)\b/.test(k)) return 'organisation';
  if (/\b(applicant|director|person|owner|signatory)\b|\bfull name\b/.test(k)) return 'person_name';
  return 'text';
}

/**
 * Enrich an LLM-proposed attribute: map it to the library when it is a known field
 * (stable key, value type and synonyms), otherwise infer a value type from its name.
 */
export function enrichAttribute(a: Omit<PlanAttribute, 'synonyms'>): PlanAttribute {
  const known = libraryMatch(a);
  if (known) return { ...known, label: a.label || known.label, required: a.required || known.required };
  return { ...a, valueType: inferValueType(a), synonyms: [...new Set([a.label.toLowerCase(), a.key.replace(/_/g, ' ')])] };
}
