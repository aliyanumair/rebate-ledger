import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractRulesFromPdf, extractRulesWithProvider, mapClaudeCandidateRules, type ClaudeRules } from "../src/lib/extractor";

async function main() {
  const pdf = await readFile(path.join(process.cwd(), "data/benchmark/launch_sprint/01_supplier_agreement_demo.pdf"));
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  let apiCalls = 0;

  try {
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = (async () => { apiCalls += 1; throw new Error("API must not be called without a key"); }) as typeof fetch;
    const noKey = await extractRulesFromPdf(pdf, "01_supplier_agreement_demo.pdf");
    assert.equal(apiCalls, 0, "no-key path must not make an Anthropic request");
    assert.equal(noKey.extractionMethod, "deterministic-regex");
    assert.equal(noKey.tiers.length, 2);

    const scopedText = [
      "Section 2.1: Eligible spend from $0 to $400,399.99 earns a 2% rebate.",
      "Section 2.2: Eligible spend of $400,400 and above earns a 3% rebate retroactively to the first eligible dollar.",
    ].join("\n");

    const structured: ClaudeRules = {
      programName: "Q3 2026 Core Equipment Rebate", supplierName: "Northstar Climate Systems",
      tiers: [
        { minSpend: "0.00", maxSpend: "400399.99", rebateRate: "2%", retroactive: null, citationIndex: 0 },
        { minSpend: "400400.00", maxSpend: null, rebateRate: "3%", retroactive: true, citationIndex: 1 },
      ],
      spaItems: [], exclusions: [],
      sourceCitations: [
        { pageNumber: 1, clauseId: "Section 2.1", excerpt: "2% rebate." },
        { pageNumber: 1, clauseId: "Section 2.2", excerpt: "3% rebate retroactively to the first eligible dollar." },
      ],
    };

    const tierScoped = mapClaudeCandidateRules(structured, "scope-test.pdf", [
      "Section 2.1: Eligible spend from $0 to $400,399.99 earns a 2% rebate.",
      "Section 2.2: Eligible spend of $400,400 and above earns a 3% rebate retroactively to the first eligible dollar.",
    ].join("\n"));
    assert.deepEqual(tierScoped.tiers.map((tier) => tier.calculation), ["unspecified", "retroactive"], "a higher tier's retroactive phrase must not resolve an ambiguous lower tier");
    assert.equal(tierScoped.tiers[1].citation.clauseId, "Section 2.2");

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      apiCalls += 1;
      const request = JSON.parse(String(init?.body)) as { model: string; output_config?: unknown; messages?: Array<{ content?: string }> };
      assert.equal(request.model, "claude-sonnet-4-6");
      assert.ok(request.output_config, "request must ask for schema-constrained JSON");
      assert.match(request.messages?.[0]?.content ?? "", /Never calculate rebates or infer missing terms/);
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(structured) }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    process.env.ANTHROPIC_API_KEY = "unit-test-placeholder";
    const claude = await extractRulesWithProvider(scopedText, "synthetic-tier-scope.pdf");
    assert.equal(claude.extractionMethod, "claude-structured");
    assert.equal(claude.programName, structured.programName);
    assert.equal(claude.supplierName, structured.supplierName);
    assert.equal(apiCalls, 1);

    globalThis.fetch = (async () => { throw new Error("simulated provider timeout"); }) as typeof fetch;
    const fallback = await extractRulesWithProvider(scopedText, "synthetic-tier-scope.pdf");
    assert.equal(fallback.extractionMethod, "deterministic-regex");
    assert.equal(fallback.tiers.length, 2);
    assert.ok(fallback.warnings.some((warning) => /deterministic extraction was used/i.test(warning)));

    console.log("Extractor provider checks passed: no-key path, structured Claude mapping, tier-scoped ambiguity, and provider-failure fallback.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
