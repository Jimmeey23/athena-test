import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Athena edge intake policy', () => {
  const source = readFileSync(resolve(process.cwd(), 'supabase/functions/ticket-ai-chat/index.ts'), 'utf8');

  it('does not force a fixed commercial verification bundle before AI drafting', () => {
    expect(source).not.toContain('the owner usually needs: studio, selected Momence member, active package/membership, relevant Momence purchase/payment context');
    expect(source).not.toMatch(/if \(commercialVerification\)[\s\S]*momencePurchaseContext/);
  });

  it('keeps edge fallback theft routing out of generic safety and Other paths', () => {
    expect(source).toContain('inferTheftOrLostItemSubCategory');
    expect(source).toMatch(/inferredCategory = 'Theft and Lost Items'/);
    expect(source).toMatch(/inferred\.category = 'Theft and Lost Items'/);
    expect(source).toContain("const theftOrLostItemSubCategory = inferTheftOrLostItemSubCategory(lower)");
    expect(source).toContain("inferred.subCategory = theftOrLostItemSubCategory");
    expect(source).toContain('mergeSpecificInferredClassification');
    expect(source).toContain('applySpecificClassificationToDraft');
    expect(source).toContain('const deterministicContext = inferContextFromText(rawIssueText, effectiveBodyContext)');
  });

  it('routes cracked PowerCycle monitor damage away from TFA malfunction', () => {
    expect(source).toContain('POWERCYCLE_MONITOR_DAMAGE_PATTERN');
    expect(source).toContain("POWERCYCLE_MONITOR_DAMAGE_PATTERN.test(lower) ? 'Broken Equipment'");
    expect(source).toContain('PowerCycle bike, monitor, console, display, or screen damage belongs to category "Repair and Maintenance" and subCategory "Broken Equipment"');
  });
});
