import type { ExtractedSupplierRules } from './extractor';
import Decimal from 'decimal.js';

/** A rule can be committed only when its rate/price is tied to a cited source. */
export function validateExtractedRules(value: unknown): value is ExtractedSupplierRules {
  if (!value || typeof value !== 'object') return false;
  const rules = value as Partial<ExtractedSupplierRules>;
  if (rules.schemaVersion !== 1 || !Array.isArray(rules.tiers) || !Array.isArray(rules.spaSkus)) return false;
  const tiers = rules.tiers;
  const spaSkus = rules.spaSkus;
  const validCitation = (citation: { source: string; pageNumber: number | null; clauseId: string | null; excerpt: string } | undefined) =>
    Boolean(citation && citation.source.trim() && Number.isInteger(citation.pageNumber) && Number(citation.pageNumber) > 0 && citation.clauseId?.trim() && citation.excerpt.trim().length >= 12);
  const citedTier = tiers.length > 0 && tiers.every((tier) => {
    if (!tier || !validCitation(tier.citation) || !['retroactive', 'incremental'].includes(tier.calculation)) return false;
    try { const minimum = new Decimal(tier.minimumSpend); const rate = new Decimal(tier.ratePercent); return minimum.gte(0) && rate.gt(0) && rate.lte(100); }
    catch { return false; }
  }) && tiers.every((tier, index) => index === 0 || new Decimal(tier.minimumSpend).gt(new Decimal(tiers[index - 1].minimumSpend)));
  let citedSpa = false;
  try {
    citedSpa = spaSkus.length > 0 && spaSkus.every((sku) =>
      Boolean(sku && sku.sku.trim() && sku.standardCost && sku.supportedPrice && validCitation(sku.citation) && new Decimal(sku.standardCost).gte(0) && new Decimal(sku.supportedPrice).gte(0) && new Decimal(sku.supportedPrice).lte(new Decimal(sku.standardCost))));
  } catch { citedSpa = false; }
  const warningsClear = Array.isArray(rules.warnings) && rules.warnings.every((warning) => !/unspecified|no volume rebate tiers/i.test(warning) || citedSpa);
  return Boolean(rules.source?.trim() && (citedTier || citedSpa) && warningsClear);
}

export function extractedRulesMatchSource(submitted: unknown, extracted: ExtractedSupplierRules, sourceName: string): boolean {
  if (!validateExtractedRules(submitted)) return false;
  const rules = submitted;
  if (rules.source !== sourceName || extracted.source !== sourceName || rules.tiers.length !== extracted.tiers.length) return false;
  const normalize = (value: string) => new Decimal(value).toDecimalPlaces(2).toFixed(2);
  const tiersMatch = rules.tiers.every((rule, index) => {
    const source = extracted.tiers[index];
    return normalize(rule.minimumSpend) === normalize(source.minimumSpend)
      && rule.ratePercent === source.ratePercent
      && rule.calculation === source.calculation
      && rule.citation.source === source.citation.source
      && rule.citation.pageNumber === source.citation.pageNumber
      && rule.citation.clauseId === source.citation.clauseId
      && rule.citation.excerpt === source.citation.excerpt;
  });
  const spaMatch = rules.spaSkus.length === extracted.spaSkus.length && rules.spaSkus.every((rule, index) => {
    const source = extracted.spaSkus[index];
    return rule.sku === source.sku && rule.standardCost === source.standardCost && rule.supportedPrice === source.supportedPrice
      && rule.citation.source === source.citation.source && rule.citation.pageNumber === source.citation.pageNumber && rule.citation.clauseId === source.citation.clauseId;
  });
  const citationsMatch = (a: { source: string; pageNumber: number | null; clauseId: string | null; excerpt: string }, b: { source: string; pageNumber: number | null; clauseId: string | null; excerpt: string }) =>
    a.source === b.source && a.pageNumber === b.pageNumber && a.clauseId === b.clauseId && a.excerpt === b.excerpt;
  const exclusionsMatch = rules.exclusions.length === extracted.exclusions.length && rules.exclusions.every((rule, index) => {
    const source = extracted.exclusions[index];
    return rule.category === source.category && rule.description === source.description && JSON.stringify(rule.values) === JSON.stringify(source.values) && citationsMatch(rule.citation, source.citation);
  });
  const deadlinesMatch = rules.claimDeadlines.length === extracted.claimDeadlines.length && rules.claimDeadlines.every((rule, index) => {
    const source = extracted.claimDeadlines[index];
    return rule.days === source.days && rule.trigger === source.trigger && citationsMatch(rule.citation, source.citation);
  });
  const claimbacksMatch = rules.spaClaimbackRules.length === extracted.spaClaimbackRules.length && rules.spaClaimbackRules.every((rule, index) => {
    const source = extracted.spaClaimbackRules[index];
    return rule.description === source.description && citationsMatch(rule.citation, source.citation);
  });
  return tiersMatch && exclusionsMatch && deadlinesMatch && claimbacksMatch && spaMatch && rules.currency === extracted.currency;
}
