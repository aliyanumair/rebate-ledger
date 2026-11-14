import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Classification =
  | "ELIGIBLE_VERIFIED"
  | "UNDERPAID_TIER_MISMATCH"
  | "UNCLAIMED_SPA_ELIGIBLE"
  | "EXCLUDED_FREIGHT_OR_TAX"
  | "EXCLUDED_RMA_RETURN"
  | "EXCLUDED_NON_QUALIFYING_SKU"
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
  /** Standard price is used when the transaction has no unit cost. */
  standardPrice?: number | string;
  approvedCustomers?: string[];
  citation?: string;
}

export interface ReconciliationRules {
  supplierName: string;
  programName: string;
  tiers: RebateTier[];
  eligibleSkus?: string[];
  excludedSkus?: string[];
  excludedSkuPrefixes?: string[];
  freightAndTaxTerms?: string[];
  spas?: SpaRule[];
  nearMissThreshold?: number | string;
  claimDeadlineDays?: number;
  clauseCitations?: string[];
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
    unclaimedRecoveryFound: string;
    quarterEndTierOpportunity: string;
    transactionCount: number;
    exceptionCount: number;
  };
  clauseCitations: string[];
}

const money = (v: Decimal.Value): Decimal => new Decimal(v || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
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
  const uplift = rebateForSpend(target, tiers).minus(rebateForSpend(spend, tiers));
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
  const allocations: Decimal[] = [];
  let allocated = new Decimal(0);
  weights.forEach((weight, index) => {
    const part = index === weights.length - 1
      ? centsTotal.minus(allocated)
      : centsTotal.mul(weight).div(sum).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    allocations.push(part);
    allocated = allocated.plus(part);
  });
  return allocations;
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
  const eligible = normalizedSet(rules.eligibleSkus);
  const excluded = normalizedSet(rules.excludedSkus);
  const spaMap = new Map((rules.spas ?? []).map((s) => [normalizeSku(s.sku), s]));
  const classified = transactions.map((tx) => {
    const sku = normalizeSku(tx.sku);
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
    } else if (eligible.size > 0 && !eligible.has(sku) && !spaMap.has(sku)) {
      classification = "UNMATCHED_SKU_NEEDS_REVIEW";
      notes = "SKU did not match an eligible SKU rule after normalization.";
    } else if (rawSpend.lt(0)) {
      classification = "EXCLUDED_RMA_RETURN";
      notes = "Negative extended amount excluded from qualifying spend.";
    } else {
      classification = "ELIGIBLE_VERIFIED";
      net = rawSpend;
    }
    const spa = spaMap.get(sku);
    const customerOk = !spa?.approvedCustomers?.length || spa.approvedCustomers.some((n) => n.toLowerCase() === (tx.customerName ?? "").toLowerCase());
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
  for (const payment of payments) {
    const amount = money(payment.amount);
    const scope = payment.scope ?? (payment.txnId ? "transaction" : payment.invoiceId ? "invoice" : payment.sku ? "sku" : "program");
    if (scope === "transaction" && payment.txnId) paymentByTxn.set(payment.txnId, (paymentByTxn.get(payment.txnId) ?? new Decimal(0)).plus(amount));
    else if (scope === "invoice" && payment.invoiceId) invoicePayments.set(payment.invoiceId, (invoicePayments.get(payment.invoiceId) ?? new Decimal(0)).plus(amount));
    else if (scope === "sku" && payment.sku) {
      const key = normalizeSku(payment.sku);
      skuPayments.set(key, (skuPayments.get(key) ?? new Decimal(0)).plus(amount));
    } else if (scope === "program") programPayment = programPayment.plus(amount);
  }
  const expectedByTxn = new Map(classified.map((r) => [r.tx.txnId, (rebateByTxn.get(r.tx.txnId) ?? new Decimal(0)).plus(r.spaEarned)]));
  const weightedAllocate = (amount: Decimal, rows: typeof classified) => {
    const weights = rows.map((r) => expectedByTxn.get(r.tx.txnId) ?? new Decimal(0));
    const allocations = allocateExact(amount, weights);
    rows.forEach((r, i) => paymentByTxn.set(r.tx.txnId, (paymentByTxn.get(r.tx.txnId) ?? new Decimal(0)).plus(allocations[i])));
  };
  for (const [invoice, amount] of invoicePayments) weightedAllocate(amount, classified.filter((r) => r.tx.invoiceId === invoice));
  for (const [sku, amount] of skuPayments) weightedAllocate(amount, classified.filter((r) => r.sku === sku));
  if (programPayment.gt(0)) weightedAllocate(programPayment, classified.filter((r) => (expectedByTxn.get(r.tx.txnId) ?? new Decimal(0)).gt(0)));
  const lines: AuditLine[] = classified.map((r) => {
    const rebate = rebateByTxn.get(r.tx.txnId) ?? new Decimal(0);
    const paid = paymentByTxn.get(r.tx.txnId) ?? new Decimal(0);
    const expected = rebate.plus(r.spaEarned);
    const recovery = money(Decimal.max(expected.minus(paid), 0));
    let classification: Classification = r.classification;
    if (classification === "ELIGIBLE_VERIFIED") {
      if (r.spaEarned.gt(0) && recovery.gt(0)) classification = "UNCLAIMED_SPA_ELIGIBLE";
      else if (recovery.gt(0)) classification = "UNDERPAID_TIER_MISMATCH";
    }
    const rule = r.spa?.citation ?? rules.tiers.find((tier) => rebate.gt(0) && totalEligibleSpend.gte(asDecimal(tier.minSpend)))?.citation;
    return {
      txnId: r.tx.txnId, date: r.tx.date, invoiceId: r.tx.invoiceId, supplier: r.tx.vendorName,
      sku: r.tx.sku, normalizedSku: r.sku, description: r.tx.description,
      customerName: r.tx.customerName, projectCode: r.tx.projectCode,
      qty: r.qty.toString(), grossSpend: str(r.rawSpend), netEligibleSpend: str(r.net),
      rebateEarned: str(rebate), spaEarned: str(r.spaEarned), supplierPaid: str(money(paid)),
      recoveryFound: str(recovery), classification, citation: rule,
      notes: recovery.gt(0) ? `${r.notes}${r.notes ? " " : ""}Expected ${str(money(expected))}; posted ${str(money(paid))}.` : r.notes,
    };
  });

  const gross = classified.reduce((sum, r) => sum.plus(r.rawSpend), new Decimal(0));
  const spaTotal = classified.reduce((sum, r) => sum.plus(r.spaEarned), new Decimal(0));
  const paidTotal = lines.reduce((sum, line) => sum.plus(asDecimal(line.supplierPaid)), new Decimal(0));
  const recoveryTotal = lines.reduce((sum, line) => sum.plus(asDecimal(line.recoveryFound)), new Decimal(0));
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
