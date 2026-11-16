import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Classification =
  | "ELIGIBLE_VERIFIED"
  | "UNDERPAID_TIER_MISMATCH"
  | "UNCLAIMED_SPA_ELIGIBLE"
  | "EXCLUDED_FREIGHT_OR_TAX"
  | "EXCLUDED_RMA_RETURN"
  | "EXCLUDED_NON_QUALIFYING_SKU"
  | "EXCLUDED_OUTSIDE_PROGRAM_PERIOD"
  | "UNMATCHED_SKU_NEEDS_REVIEW";

export interface PurchaseTransaction {
  txnId: string;
  date: string;
  vendorName: string;
  sku: string;
  description: string;
  qty: number | string;
  unitCost: number | string;
  extendedCost: number | string;
  customerName?: string;
  projectCode?: string;
  txnType?: string;
  invoiceId?: string;
}

export interface RebateTier {
  /** Minimum qualifying spend for this tier, inclusive. */
  minSpend: number | string;
  ratePercent: number | string;
  /** Retroactive applies the selected rate to all spend. Incremental applies marginal rates by band. */
  mode?: "retroactive" | "incremental";
  citation?: string;
}

export interface SpaRule {
  sku: string;
  supportedPrice: number | string;
  /** Stack volume rebate only when the verified agreement explicitly permits it. Defaults to non-stackable. */
  stackWithVolumeRebate?: boolean;
  /** Standard price is used when the transaction has no unit cost. */
  standardPrice?: number | string;
  approvedCustomers?: string[];
  citation?: string;
}

export interface ReconciliationRules {
  supplierName: string;
  programName: string;
  verification?: { status: "verified" | "unverified"; verifiedBy: string; ruleVersion: string };
  opportunityMethod?: "incremental-total-rebate" | "rate-difference-at-target";
  tiers: RebateTier[];
  eligibleSkus?: string[];
  excludedSkus?: string[];
  excludedSkuPrefixes?: string[];
  freightAndTaxTerms?: string[];
  spas?: SpaRule[];
  nearMissThreshold?: number | string;
  claimDeadlineDays?: number;
  clauseCitations?: string[];
  effectiveStartDate?: string;
  effectiveEndDate?: string;
}

export interface SupplierPayment {
  scope?: "transaction" | "invoice" | "sku" | "program";
  txnId?: string;
  invoiceId?: string;
  sku?: string;
  amount: number | string;
  reference?: string;
}

export interface CreditStatementLine {
  creditId: string;
  date?: string;
  creditType?: string;
  eligibleSpendBasis: number | string;
  ratePercent: number | string;
  paidCredit: number | string;
  invoiceReferences?: string;
  sku?: string;
  citation?: string;
}

export interface CreditStatementReconciliation {
  lines: Array<{
    creditId: string;
    date: string;
    creditType: string;
    eligibleSpendBasis: string;
    ratePercent: string;
    expectedCredit: string;
    paidCredit: string;
    recoveryFound: string;
    invoiceReferences: string;
    sku: string;
    citation: string;
    classification: "PAID_AS_EXPECTED" | "UNDERPAID_CREDIT" | "OVERPAID_CREDIT";
  }>;
  totals: { eligibleSpendBasis: string; expectedCredit: string; paidCredit: string; recoveryFound: string; overpayment: string };
}

export interface AuditLine {
  txnId: string;
  date: string;
  invoiceId?: string;
  supplier: string;
  sku: string;
  normalizedSku: string;
  description: string;
  customerName?: string;
  projectCode?: string;
  qty: string;
  grossSpend: string;
  netEligibleSpend: string;
  rebateEarned: string;
  spaEarned: string;
  supplierPaid: string;
  recoveryFound: string;
  classification: Classification;
  citation?: string;
  notes: string;
}

export interface TierOpportunity {
  currentSpend: string;
  currentRatePercent: string;
  nextTierSpend: string;
  nextRatePercent: string;
  additionalSpendNeeded: string;
  projectedRebateUplift: string;
  nearMiss: boolean;
  citation?: string;
}

export interface ReconciliationResult {
  supplierName: string;
  programName: string;
  lines: AuditLine[];
  opportunities: TierOpportunity[];
  totals: {
    grossSpend: string;
    netEligibleSpend: string;
    rebateEarned: string;
    spaEarned: string;
    supplierPaid: string;
    /** Program-scope credits retained at aggregate level; never allocated to invented invoice lines. */
    unallocatedProgramPayment: string;
    unallocatedProgramPaymentReferences: string[];
    programStatementProvided: boolean;
    unclaimedRecoveryFound: string;
    quarterEndTierOpportunity: string;
    transactionCount: number;
    exceptionCount: number;
  };
  clauseCitations: string[];
}

const money = (v: Decimal.Value): Decimal => {
  if (v === "" || v === undefined || v === null) throw new Error("Missing monetary value.");
  const amount = new Decimal(v);
  if (!amount.isFinite()) throw new Error("Invalid monetary value.");
  return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
};
const str = (v: Decimal): string => v.toFixed(2);

export function normalizeSku(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizedSet(values: string[] = []): Set<string> {
  return new Set(values.map(normalizeSku).filter(Boolean));
}

function asDecimal(value: number | string | undefined, fallback = 0): Decimal {
  if (value === undefined || value === null || value === "") return new Decimal(fallback);
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error(`Invalid monetary or quantity value: ${value}`);
  return parsed;
}

function containsTerm(tx: PurchaseTransaction, terms: string[]): boolean {
  const haystack = `${tx.sku} ${tx.description} ${tx.txnType ?? ""}`.toLowerCase();
  return terms.some((term) => term && haystack.includes(term.toLowerCase()));
}

function rebateForSpend(spend: Decimal, tiers: RebateTier[]): Decimal {
  if (spend.lte(0) || tiers.length === 0) return new Decimal(0);
  const sorted = [...tiers].sort((a, b) => asDecimal(a.minSpend).cmp(asDecimal(b.minSpend)));
  const mode = sorted.find((t) => t.mode)?.mode ?? "retroactive";
  if (mode === "retroactive") {
    const tier = [...sorted].reverse().find((t) => spend.gte(asDecimal(t.minSpend)));
    return tier ? spend.mul(asDecimal(tier.ratePercent)).div(100) : new Decimal(0);
  }
  let earned = new Decimal(0);
  for (let i = 0; i < sorted.length; i += 1) {
    const floor = asDecimal(sorted[i].minSpend);
    const ceiling = sorted[i + 1] ? asDecimal(sorted[i + 1].minSpend) : spend;
    const bandSpend = Decimal.min(Decimal.max(spend.minus(floor), 0), Decimal.max(ceiling.minus(floor), 0));
    earned = earned.plus(bandSpend.mul(asDecimal(sorted[i].ratePercent)).div(100));
  }
  return earned;
}

function effectiveRate(spend: Decimal, tiers: RebateTier[]): Decimal {
  if (spend.lte(0)) return new Decimal(0);
  return rebateForSpend(spend, tiers).div(spend).mul(100);
}

function opportunityFor(spend: Decimal, rules: ReconciliationRules): TierOpportunity[] {
  const tiers = [...rules.tiers].sort((a, b) => asDecimal(a.minSpend).cmp(asDecimal(b.minSpend)));
  const next = tiers.find((tier) => asDecimal(tier.minSpend).gt(spend));
  if (!next) return [];
  const target = asDecimal(next.minSpend);
  const needed = target.minus(spend);
  const uplift = rules.opportunityMethod === "rate-difference-at-target"
    ? target.mul(asDecimal(next.ratePercent).minus(effectiveRate(spend, tiers))).div(100)
    : rebateForSpend(target, tiers).minus(rebateForSpend(spend, tiers));
  return [{
    currentSpend: str(money(spend)),
    currentRatePercent: effectiveRate(spend, tiers).toDecimalPlaces(4).toFixed(4),
    nextTierSpend: str(money(target)),
    nextRatePercent: asDecimal(next.ratePercent).toDecimalPlaces(4).toFixed(4),
    additionalSpendNeeded: str(money(needed)),
    projectedRebateUplift: str(money(uplift)),
    nearMiss: needed.lte(asDecimal(rules.nearMissThreshold ?? 15000)),
    citation: next.citation,
  }];
}

function allocateExact(total: Decimal, weights: Decimal[]): Decimal[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a.plus(b), new Decimal(0));
  if (sum.lte(0)) return weights.map(() => new Decimal(0));
  const centsTotal = total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const exact = weights.map(weight => centsTotal.mul(weight).div(sum));
  const allocations = exact.map(part => part.toDecimalPlaces(2, Decimal.ROUND_DOWN));
  const allocated = allocations.reduce((total, part) => total.plus(part), new Decimal(0));
  const order = exact.map((part, index) => ({ index, remainder: part.minus(allocations[index]) }))
    .sort((a, b) => b.remainder.cmp(a.remainder) || a.index - b.index);
  let remainder = centsTotal.minus(allocated);
  for (const item of order) {
    if (remainder.lte(0)) break;
    allocations[item.index] = allocations[item.index].plus("0.01");
    remainder = remainder.minus("0.01");
  }
  return allocations;
}

/** Fail closed before any accounting arithmetic. Verification is explicit, never extraction confidence. */
export function validateReconciliationRules(rules: ReconciliationRules): void {
  if (!rules || typeof rules !== "object" || !rules.supplierName?.trim() || !rules.programName?.trim()) throw new Error("Supplier and program are required.");
  if (rules.verification?.status !== "verified" || !rules.verification.verifiedBy?.trim() || !rules.verification.ruleVersion?.trim()) throw new Error("Reconciliation blocked: contract rules must be explicitly verified with reviewer and version.");
  if (!Array.isArray(rules.tiers) || rules.tiers.length === 0) throw new Error("At least one verified tier is required.");
  for (const date of [rules.effectiveStartDate, rules.effectiveEndDate]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error("Contract effective dates must be valid ISO calendar dates.");
  if (rules.effectiveStartDate && rules.effectiveEndDate && rules.effectiveStartDate > rules.effectiveEndDate) throw new Error("Contract effective date range is invalid.");
  let mode: string | undefined;
  const thresholds = new Set<string>();
  for (const tier of rules.tiers) {
    if (!tier || tier.minSpend === "" || tier.ratePercent === "" || tier.minSpend === undefined || tier.ratePercent === undefined) throw new Error("Tier spend and rate are required.");
    const floor = asDecimal(tier.minSpend), rate = asDecimal(tier.ratePercent);
    if (floor.lt(0) || rate.lt(0) || rate.gt(100)) throw new Error("Tier spend must be nonnegative and rate must be between 0 and 100.");
    if (tier.mode !== "retroactive" && tier.mode !== "incremental") throw new Error("Every tier must explicitly specify retroactive or incremental calculation.");
    if (mode && mode !== tier.mode) throw new Error("Conflicting tier calculation methods require review.");
    mode = tier.mode;
    if (!tier.citation?.trim()) throw new Error("Every tier requires a source clause citation.");
    if (thresholds.has(floor.toString())) throw new Error("Duplicate tier threshold requires review.");
    thresholds.add(floor.toString());
  }
  for (const spa of rules.spas ?? []) {
    if (!normalizeSku(spa.sku) || !spa.citation?.trim() || asDecimal(spa.supportedPrice).lt(0) || (spa.standardPrice !== undefined && asDecimal(spa.standardPrice).lt(0)) || (spa.stackWithVolumeRebate !== undefined && typeof spa.stackWithVolumeRebate !== "boolean")) throw new Error("SPA rules require SKU, nonnegative exact prices, a citation, and an explicit boolean stacking choice when specified.");
  }
}

/**
 * Reconciles raw ERP purchases against already-reviewed program rules and posted supplier payments.
 * This function performs the arithmetic only; it does not infer contract terms.
 */
export function reconcile(
  transactions: PurchaseTransaction[],
  rules: ReconciliationRules,
  payments: SupplierPayment[] = [],
): ReconciliationResult {
  validateReconciliationRules(rules);
  const transactionIds = new Set<string>();
  for (const tx of transactions) {
    if (!tx.txnId?.trim() || transactionIds.has(tx.txnId)) throw new Error("Missing or duplicate transaction ID; reconcile only unique source lines.");
    transactionIds.add(tx.txnId);
    if (!tx.sku?.trim() || !tx.date?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date) || Number.isNaN(Date.parse(tx.date)) || new Date(tx.date).toISOString().slice(0, 10) !== tx.date) throw new Error(`Invalid SKU or ISO date on ${tx.txnId}.`);
    for (const value of [tx.qty, tx.unitCost, tx.extendedCost]) {
      if (value === "" || value === undefined || value === null) throw new Error(`Missing numeric value on ${tx.txnId}.`);
      asDecimal(value);
    }
  }
  const eligible = normalizedSet(rules.eligibleSkus);
  const excluded = normalizedSet(rules.excludedSkus);
  const spaMap = new Map((rules.spas ?? []).map((s) => [normalizeSku(s.sku), s]));
  const classified = transactions.map((tx) => {
    const sku = normalizeSku(tx.sku);
    const spa = spaMap.get(sku);
    const customerOk = !spa?.approvedCustomers?.length || spa.approvedCustomers.some((n) => n.toLowerCase() === (tx.customerName ?? "").toLowerCase());
    const rawSpend = money(tx.extendedCost);
    const qty = asDecimal(tx.qty);
    let classification: Classification;
    let net = new Decimal(0);
    let notes = "";
    if (qty.lt(0) || /\bRMA\b|\bRETURN\b|\bCREDIT\b/i.test(`${tx.txnType ?? ""} ${tx.description}`)) {
      classification = "EXCLUDED_RMA_RETURN";
      notes = "Return or credit transaction excluded from qualifying spend.";
    } else if (containsTerm(tx, rules.freightAndTaxTerms ?? ["freight", "shipping", "tax", "delivery"])) {
      classification = "EXCLUDED_FREIGHT_OR_TAX";
      notes = "Freight, tax, or delivery line excluded by program rule.";
    } else if (excluded.has(sku) || (rules.excludedSkuPrefixes ?? []).some((p) => sku.startsWith(normalizeSku(p)))) {
      classification = "EXCLUDED_NON_QUALIFYING_SKU";
      notes = "SKU is listed as excluded by the program.";
    } else if ((rules.effectiveStartDate && tx.date < rules.effectiveStartDate) || (rules.effectiveEndDate && tx.date > rules.effectiveEndDate)) {
      classification = "EXCLUDED_OUTSIDE_PROGRAM_PERIOD";
      notes = "Transaction date falls outside the verified contract period.";
    } else if (eligible.size > 0 && !eligible.has(sku) && !(spa && customerOk)) {
      classification = "UNMATCHED_SKU_NEEDS_REVIEW";
      notes = "SKU did not match an eligible SKU rule after normalization.";
    } else if (rawSpend.lt(0)) {
      classification = "EXCLUDED_RMA_RETURN";
      notes = "Negative extended amount excluded from qualifying spend.";
    } else {
      classification = "ELIGIBLE_VERIFIED";
      net = rawSpend;
    }
    if (classification === "ELIGIBLE_VERIFIED" && spa && customerOk && spa.stackWithVolumeRebate !== true) {
      net = new Decimal(0);
      notes = "Verified SPA benefit is non-stackable with the volume rebate; this line is excluded from volume-tier spend.";
    }
    const standard = spa?.standardPrice === undefined ? asDecimal(tx.unitCost) : asDecimal(spa.standardPrice);
    const spaEarned = spa && customerOk && classification === "ELIGIBLE_VERIFIED"
      ? money(Decimal.max(standard.minus(asDecimal(spa.supportedPrice)), 0).mul(qty))
      : new Decimal(0);
    return { tx, sku, rawSpend, qty, classification, net, spaEarned, notes, spa };
  });

  const totalEligibleSpend = classified.reduce((sum, r) => sum.plus(r.net), new Decimal(0));
  const aggregateRebate = money(rebateForSpend(totalEligibleSpend, rules.tiers));
  const eligibleRows = classified.filter((r) => r.net.gt(0));
  const rebateAllocations = allocateExact(aggregateRebate, eligibleRows.map((r) => r.net));
  const rebateByTxn = new Map<string, Decimal>();
  eligibleRows.forEach((r, i) => rebateByTxn.set(r.tx.txnId, rebateAllocations[i]));

  const paymentByTxn = new Map<string, Decimal>();
  const invoicePayments = new Map<string, Decimal>();
  const skuPayments = new Map<string, Decimal>();
  let programPayment = new Decimal(0);
  let programStatementProvided = false;
  const programPaymentReferences: string[] = [];
  for (const payment of payments) {
    const amount = money(payment.amount);
    if (amount.lt(0)) throw new Error("Negative supplier credits require an explicit adjustment policy.");
    const scope = payment.scope ?? (payment.txnId ? "transaction" : payment.invoiceId ? "invoice" : payment.sku ? "sku" : "program");
    if ((scope === "transaction" && !transactions.some(tx => tx.txnId === payment.txnId)) || (scope === "invoice" && !transactions.some(tx => tx.invoiceId === payment.invoiceId)) || (scope === "sku" && !transactions.some(tx => normalizeSku(tx.sku) === normalizeSku(payment.sku ?? "")))) throw new Error("Supplier payment scope did not match a source transaction; review required.");
    if (scope === "transaction" && payment.txnId) paymentByTxn.set(payment.txnId, (paymentByTxn.get(payment.txnId) ?? new Decimal(0)).plus(amount));
    else if (scope === "invoice" && payment.invoiceId) invoicePayments.set(payment.invoiceId, (invoicePayments.get(payment.invoiceId) ?? new Decimal(0)).plus(amount));
    else if (scope === "sku" && payment.sku) {
      const key = normalizeSku(payment.sku);
      skuPayments.set(key, (skuPayments.get(key) ?? new Decimal(0)).plus(amount));
    } else if (scope === "program") {
      programStatementProvided = true;
      programPayment = programPayment.plus(amount);
      if (payment.reference?.trim()) programPaymentReferences.push(payment.reference.trim());
    }
  }
  const expectedByTxn = new Map(classified.map((r) => [r.tx.txnId, (rebateByTxn.get(r.tx.txnId) ?? new Decimal(0)).plus(r.spaEarned)]));
  const weightedAllocate = (amount: Decimal, rows: typeof classified) => {
    const weights = rows.map((r) => expectedByTxn.get(r.tx.txnId) ?? new Decimal(0));
    const allocations = allocateExact(amount, weights);
    rows.forEach((r, i) => paymentByTxn.set(r.tx.txnId, (paymentByTxn.get(r.tx.txnId) ?? new Decimal(0)).plus(allocations[i])));
  };
  for (const [invoice, amount] of invoicePayments) weightedAllocate(amount, classified.filter((r) => r.tx.invoiceId === invoice));
  for (const [sku, amount] of skuPayments) weightedAllocate(amount, classified.filter((r) => r.sku === sku));
  // A program-level statement total has no invoice allocation. Keep it aggregate; spreading it
  // across purchase rows would fabricate per-invoice paid amounts and claim support.
  const lines: AuditLine[] = classified.map((r) => {
    const rebate = rebateByTxn.get(r.tx.txnId) ?? new Decimal(0);
    const paid = paymentByTxn.get(r.tx.txnId) ?? new Decimal(0);
    const expected = rebate.plus(r.spaEarned);
    const recovery = programStatementProvided ? new Decimal(0) : money(Decimal.max(expected.minus(paid), 0));
    let classification: Classification = r.classification;
    if (classification === "ELIGIBLE_VERIFIED") {
      if (r.spaEarned.gt(0) && recovery.gt(0)) classification = "UNCLAIMED_SPA_ELIGIBLE";
      else if (recovery.gt(0)) classification = "UNDERPAID_TIER_MISMATCH";
    }
    const rule = r.spa?.citation ?? [...rules.tiers].sort((a, b) => asDecimal(b.minSpend).cmp(asDecimal(a.minSpend))).find((tier) => rebate.gt(0) && totalEligibleSpend.gte(asDecimal(tier.minSpend)))?.citation;
    return {
      txnId: r.tx.txnId, date: r.tx.date, invoiceId: r.tx.invoiceId, supplier: r.tx.vendorName,
      sku: r.tx.sku, normalizedSku: r.sku, description: r.tx.description,
      customerName: r.tx.customerName, projectCode: r.tx.projectCode,
      qty: r.qty.toString(), grossSpend: str(r.rawSpend), netEligibleSpend: str(r.net),
      rebateEarned: str(rebate), spaEarned: str(r.spaEarned), supplierPaid: str(money(paid)),
      recoveryFound: str(recovery), classification, citation: rule,
      notes: programStatementProvided
        ? `${r.notes}${r.notes ? " " : ""}Program-level posted credits of ${str(money(programPayment))} are not allocated to this transaction.`
        : recovery.gt(0) ? `${r.notes}${r.notes ? " " : ""}Expected ${str(money(expected))}; posted ${str(money(paid))}.` : r.notes,
    };
  });

  const gross = classified.reduce((sum, r) => sum.plus(r.rawSpend), new Decimal(0));
  const spaTotal = classified.reduce((sum, r) => sum.plus(r.spaEarned), new Decimal(0));
  const directlyMappedPaid = lines.reduce((sum, line) => sum.plus(asDecimal(line.supplierPaid)), new Decimal(0));
  const paidTotal = directlyMappedPaid.plus(programPayment);
  const recoveryTotal = programStatementProvided
    ? Decimal.max(aggregateRebate.plus(spaTotal).minus(directlyMappedPaid).minus(programPayment), 0)
    : lines.reduce((sum, line) => sum.plus(asDecimal(line.recoveryFound)), new Decimal(0));
  const opportunity = opportunityFor(totalEligibleSpend, rules);
  const opportunityTotal = opportunity.reduce((sum, row) => sum.plus(asDecimal(row.projectedRebateUplift)), new Decimal(0));
  return {
    supplierName: rules.supplierName,
    programName: rules.programName,
    lines,
    opportunities: opportunity,
    totals: {
      grossSpend: str(money(gross)), netEligibleSpend: str(money(totalEligibleSpend)),
      rebateEarned: str(aggregateRebate), spaEarned: str(money(spaTotal)), supplierPaid: str(money(paidTotal)),
      unallocatedProgramPayment: str(money(programPayment)),
      unallocatedProgramPaymentReferences: [...new Set(programPaymentReferences)],
      programStatementProvided,
      unclaimedRecoveryFound: str(money(recoveryTotal)), quarterEndTierOpportunity: str(money(opportunityTotal)),
      transactionCount: lines.length,
      exceptionCount: lines.filter((l) => l.classification !== "ELIGIBLE_VERIFIED").length,
    },
    clauseCitations: rules.clauseCitations ?? [],
  };
}

/**
 * Reconciles manufacturer credit memo rows independently from ERP purchase lines.
 * This supports quarterly statement adjustments where a credit is calculated from a stated spend basis
 * and is not attached to one individual invoice. No rebate contract terms are inferred here: callers
 * must provide the extracted rate and spend basis with a citation.
 */
export function reconcileCreditStatement(statementLines: CreditStatementLine[]): CreditStatementReconciliation {
  const lines = statementLines.map((line) => {
    const basis = money(line.eligibleSpendBasis);
    const rate = asDecimal(line.ratePercent);
    const expected = money(basis.mul(rate).div(100));
    const paid = money(line.paidCredit);
    const variance = money(expected.minus(paid));
    return {
      creditId: line.creditId,
      date: line.date ?? "",
      creditType: line.creditType ?? "Quarterly rebate credit",
      eligibleSpendBasis: str(basis),
      ratePercent: rate.toDecimalPlaces(4).toFixed(4),
      expectedCredit: str(expected),
      paidCredit: str(paid),
      recoveryFound: str(Decimal.max(variance, 0)),
      invoiceReferences: line.invoiceReferences ?? "",
      sku: line.sku ?? "",
      citation: line.citation ?? "",
      classification: variance.gt(0) ? "UNDERPAID_CREDIT" as const : variance.lt(0) ? "OVERPAID_CREDIT" as const : "PAID_AS_EXPECTED" as const,
    };
  });
  return {
    lines,
    totals: {
      eligibleSpendBasis: str(money(lines.reduce((sum, l) => sum.plus(asDecimal(l.eligibleSpendBasis)), new Decimal(0)))),
      expectedCredit: str(money(lines.reduce((sum, l) => sum.plus(asDecimal(l.expectedCredit)), new Decimal(0)))),
      paidCredit: str(money(lines.reduce((sum, l) => sum.plus(asDecimal(l.paidCredit)), new Decimal(0)))),
      recoveryFound: str(money(lines.reduce((sum, l) => sum.plus(asDecimal(l.recoveryFound)), new Decimal(0)))),
      overpayment: str(money(lines.reduce((sum, l) => sum.plus(Decimal.max(asDecimal(l.paidCredit).minus(asDecimal(l.expectedCredit)), 0)), new Decimal(0)))),
    },
  };
}
