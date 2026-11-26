import { distance } from 'fastest-levenshtein';
import type { ComparisonRow, Finding, PlanAttribute, Severity, ValueType } from '@workbench/shared';
import {
  formatMoney,
  isAdjacentTransposition,
  normalizeDate,
  normalizeFreeText,
  normalizeIdentifier,
  normalizeMoney,
  normalizeName,
  normalizeNumber,
  normalizeOrganisation,
  parseAddress,
} from './normalize.js';

/**
 * Deterministic comparison. Produces the comparison matrix and "derived" findings:
 * conclusions computed by explicit, explainable rules from extracted values.
 */

export type Relation = 'match' | 'equivalent' | 'mismatch';

export interface ValueComparison {
  relation: Relation;
  rule: string | null;
  severity: Severity;
  note: string;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const eq = (a: string, b: string, note = ''): ValueComparison => ({
  relation: same(a, b) ? 'match' : 'equivalent',
  rule: null,
  severity: 'info',
  note,
});
const mismatch = (rule: string, severity: Severity, note: string): ValueComparison => ({ relation: 'mismatch', rule, severity, note });

export function compareValues(type: ValueType, a: string, b: string): ValueComparison {
  switch (type) {
    case 'money': {
      const ma = normalizeMoney(a);
      const mb = normalizeMoney(b);
      if (!ma || !mb) break;
      if (ma.currency && mb.currency && ma.currency !== mb.currency) {
        return mismatch('money.currency', 'high', `Different currencies (${ma.currency} vs ${mb.currency}).`);
      }
      const max = Math.max(Math.abs(ma.amount), Math.abs(mb.amount));
      const diff = max === 0 ? 0 : Math.abs(ma.amount - mb.amount) / max;
      if (diff === 0) return eq(a, b, 'Same amount.');
      if (diff <= 0.01) return { relation: 'equivalent', rule: null, severity: 'info', note: 'Amounts agree within 1%.' };
      const pct = (diff * 100).toFixed(1);
      const severity: Severity = diff > 0.1 ? 'high' : diff > 0.02 ? 'medium' : 'low';
      return mismatch('money.mismatch', severity, `${formatMoney(ma)} vs ${formatMoney(mb)}: a ${pct}% difference.`);
    }
    case 'date': {
      const da = normalizeDate(a);
      const db = normalizeDate(b);
      if (!da || !db) break;
      if (da === db) return eq(a, b, 'Same date.');
      return mismatch('date.mismatch', 'medium', `${da} vs ${db}.`);
    }
    case 'person_name': {
      const na = normalizeName(a);
      const nb = normalizeName(b);
      if (na === nb) return eq(a, b, 'Same name once titles and initials are ignored.');
      const ta = new Set(na.split(' '));
      const tb = new Set(nb.split(' '));
      const subset = [...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t));
      if (subset) return { relation: 'equivalent', rule: null, severity: 'info', note: 'One name is a fuller form of the other.' };
      if (distance(na, nb) <= 2) {
        return mismatch('name.spelling_variant', 'medium', `"${a}" and "${b}" differ by ${distance(na, nb)} character(s): possible misspelling or a different person.`);
      }
      return mismatch('name.different', 'high', 'The names do not match.');
    }
    case 'organisation': {
      const na = normalizeOrganisation(a);
      const nb = normalizeOrganisation(b);
      if (na === nb) return eq(a, b, 'Same organisation once legal suffixes and plurals are ignored.');
      if (distance(na, nb) <= 2) return mismatch('organisation.spelling_variant', 'medium', 'Organisation names differ slightly.');
      return mismatch('organisation.different', 'high', 'The organisation names do not match.');
    }
    case 'address': {
      const pa = parseAddress(a);
      const pb = parseAddress(b);
      const problems: string[] = [];
      let rule: string | null = null;
      if (pa.houseNumber && pb.houseNumber && pa.houseNumber !== pb.houseNumber) {
        problems.push(`house number ${pa.houseNumber} vs ${pb.houseNumber}`);
        rule = 'address.house_number';
      }
      if (pa.postcode && pb.postcode && pa.postcode !== pb.postcode) {
        problems.push(`postcode ${pa.postcode} vs ${pb.postcode}`);
        rule ??= 'address.postcode';
      }
      const restDiff = Math.max(pa.rest.length, pb.rest.length) === 0 ? 0 : distance(pa.rest, pb.rest) / Math.max(pa.rest.length, pb.rest.length);
      if (restDiff > 0.25 && !(pa.rest.includes(pb.rest) || pb.rest.includes(pa.rest))) {
        problems.push('street/town differ');
        rule ??= 'address.different';
      }
      if (rule) return mismatch(rule, rule === 'address.different' ? 'high' : 'medium', `Address differs: ${problems.join('; ')}.`);
      return eq(a, b, 'Same address once abbreviations are expanded.');
    }
    case 'identifier': {
      const ia = normalizeIdentifier(a);
      const ib = normalizeIdentifier(b);
      if (ia === ib) return eq(a, b, 'Same identifier.');
      if (isAdjacentTransposition(ia, ib)) {
        return mismatch('identifier.transposition', 'high', `"${a}" vs "${b}": two adjacent characters are swapped — likely a transcription error, or a different record.`);
      }
      if (distance(ia, ib) === 1) return mismatch('identifier.typo', 'high', `"${a}" vs "${b}" differ by one character.`);
      return mismatch('identifier.different', 'high', `"${a}" vs "${b}" are different identifiers.`);
    }
    case 'number': {
      const na = normalizeNumber(a);
      const nb = normalizeNumber(b);
      if (na === null || nb === null) break;
      return na === nb ? eq(a, b) : mismatch('number.mismatch', 'medium', `${na} vs ${nb}.`);
    }
    case 'text':
      break;
  }
  return normalizeFreeText(a) === normalizeFreeText(b) ? eq(a, b) : mismatch('text.mismatch', 'low', 'Values differ.');
}

/* --------------------------------------------------------------------------------- */

export interface AttributeCell {
  documentId: string;
  alias: string;
  documentName: string;
  value: string | null;
  evidenceHandle: string | null;
}

export interface CompareContext {
  nextId: () => string;
}

const RULE_TITLES: Record<string, string> = {
  'money.mismatch': 'amounts differ',
  'money.currency': 'currencies differ',
  'date.mismatch': 'dates differ',
  'name.spelling_variant': 'spelling differs',
  'name.different': 'different names',
  'organisation.spelling_variant': 'spelling differs',
  'organisation.different': 'different organisations',
  'address.house_number': 'house number differs',
  'address.postcode': 'postcode differs',
  'address.different': 'different addresses',
  'identifier.transposition': 'possible transposed characters',
  'identifier.typo': 'one character differs',
  'identifier.different': 'different identifiers',
  'number.mismatch': 'values differ',
  'text.mismatch': 'values differ',
};

const describe = (cells: AttributeCell[]) => cells.map((c) => `${c.alias} (${c.documentName})`).join(', ');

/**
 * Compare one attribute across documents. Values are clustered by equivalence;
 * the largest cluster (earliest on ties, i.e. the first selected document) is the
 * reference, and every other cluster yields one derived discrepancy.
 */
export function compareAttribute(attr: PlanAttribute, cells: AttributeCell[], ctx: CompareContext): { row: ComparisonRow; findings: Finding[] } {
  const found = cells.filter((c): c is AttributeCell & { value: string } => c.value !== null && c.value.trim() !== '');
  const clusters: (AttributeCell & { value: string })[][] = [];
  for (const cell of found) {
    const home = clusters.find((cl) => compareValues(attr.valueType, cl[0]!.value, cell.value).relation !== 'mismatch');
    if (home) home.push(cell);
    else clusters.push([cell]);
  }
  const reference = clusters.reduce<(AttributeCell & { value: string })[] | undefined>(
    (best, cl) => (!best || cl.length > best.length ? cl : best),
    undefined,
  );

  const statusOf = (cell: AttributeCell): ComparisonRow['cells'][number]['status'] => {
    if (cell.value === null || cell.value.trim() === '') return 'missing';
    if (!reference || !reference.includes(cell as AttributeCell & { value: string })) return 'mismatch';
    const rep = reference[0]!;
    return cell === rep ? 'match' : compareValues(attr.valueType, rep.value, cell.value!).relation === 'match' ? 'match' : 'equivalent';
  };

  const rowCells = cells.map((c) => ({
    documentId: c.documentId,
    value: c.value,
    evidenceHandle: c.evidenceHandle,
    status: statusOf(c),
  }));

  const findings: Finding[] = [];
  if (reference) {
    const rep = reference[0]!;
    for (const cluster of clusters) {
      if (cluster === reference) continue;
      const other = cluster[0]!;
      const cmp = compareValues(attr.valueType, rep.value, other.value);
      const plural = reference.length > 1 ? 'state' : 'states';
      findings.push({
        id: ctx.nextId(),
        category: 'discrepancy',
        tier: 'derived',
        title: `${attr.label}: ${cmp.rule ? (RULE_TITLES[cmp.rule] ?? 'values differ') : 'values differ'}`,
        detail: `${describe(cluster)} ${cluster.length > 1 ? 'state' : 'states'} "${other.value}", but ${describe(reference)} ${plural} "${rep.value}". ${cmp.note}`.trim(),
        attribute: attr.key,
        severity: cmp.severity,
        rule: cmp.rule ?? 'value.mismatch',
        verdict: null,
        verdictNote: null,
        documentIds: [...new Set([...reference, ...cluster].map((c) => c.documentId))],
        evidence: [
          ...reference.flatMap((c) => (c.evidenceHandle ? [{ handle: c.evidenceHandle, role: 'supports' as const }] : [])),
          ...cluster.flatMap((c) => (c.evidenceHandle ? [{ handle: c.evidenceHandle, role: 'contradicts' as const }] : [])),
        ],
      });
    }
  }

  const statuses = rowCells.map((c) => c.status);
  const rowStatus: ComparisonRow['rowStatus'] =
    found.length === 0
      ? 'not_found'
      : statuses.includes('mismatch')
        ? 'inconsistent'
        : statuses.includes('missing')
          ? 'partial'
          : 'consistent';

  return {
    row: { attribute: attr.key, label: attr.label, valueType: attr.valueType, rowStatus, cells: rowCells },
    findings,
  };
}

/**
 * Derived date rule: an expiry date earlier than the application date (high) or than
 * the review date (medium) is flagged.
 */
export function checkExpiry(
  expiryAttr: PlanAttribute,
  expiryCells: AttributeCell[],
  applicationCells: AttributeCell[],
  reviewDateIso: string,
  ctx: CompareContext,
): Finding[] {
  const appCell = applicationCells.find((c) => c.value && normalizeDate(c.value));
  const appIso = appCell?.value ? normalizeDate(appCell.value) : null;
  const out: Finding[] = [];
  for (const cell of expiryCells) {
    const iso = cell.value ? normalizeDate(cell.value) : null;
    if (!iso || !cell.evidenceHandle) continue;
    const beforeApplication = appIso !== null && iso < appIso;
    if (!beforeApplication && iso >= reviewDateIso) continue;
    out.push({
      id: ctx.nextId(),
      category: 'discrepancy',
      tier: 'derived',
      title: beforeApplication ? `${expiryAttr.label}: expired before the application date` : `${expiryAttr.label}: expired`,
      detail: beforeApplication
        ? `${cell.alias} (${cell.documentName}) shows an expiry of ${iso}, before the application date ${appIso} stated in ${appCell!.alias}.`
        : `${cell.alias} (${cell.documentName}) shows an expiry of ${iso}, which is before the review date ${reviewDateIso}.`,
      attribute: expiryAttr.key,
      severity: beforeApplication ? 'high' : 'medium',
      rule: 'date.expired',
      verdict: null,
      verdictNote: null,
      documentIds: [...new Set([cell.documentId, ...(beforeApplication && appCell ? [appCell.documentId] : [])])],
      evidence: [
        { handle: cell.evidenceHandle, role: 'supports' },
        ...(beforeApplication && appCell?.evidenceHandle ? [{ handle: appCell.evidenceHandle, role: 'supports' as const }] : []),
      ],
    });
  }
  return out;
}
