import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Athena edge intake policy', () => {
  const source = readFileSync(resolve(process.cwd(), 'supabase/functions/ticket-ai-chat/index.ts'), 'utf8');

  it('does not force a fixed commercial verification bundle before AI drafting', () => {
    expect(source).not.toContain('the owner usually needs: studio, selected Momence member, active package/membership, relevant Momence purchase/payment context');
    expect(source).not.toMatch(/if \(commercialVerification\)[\s\S]*momencePurchaseContext/);
  });
});
