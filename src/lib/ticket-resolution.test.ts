import { describe, expect, it } from 'vitest';
import {
  RESOLUTION_TYPES,
  validateResolvePayload,
  validateTransition,
} from './ticket-resolution';

describe('validateTransition', () => {
  it('allows claim from New', () => {
    const r = validateTransition('claim', 'New');
    expect(r.valid).toBe(true);
    expect(r.nextStatus).toBe('In Progress');
  });

  it('allows await_member from In Progress', () => {
    const r = validateTransition('await_member', 'In Progress');
    expect(r.valid).toBe(true);
    expect(r.nextStatus).toBe('Awaiting Member');
  });

  it('allows unblock from Awaiting Member', () => {
    const r = validateTransition('unblock', 'Awaiting Member');
    expect(r.valid).toBe(true);
    expect(r.nextStatus).toBe('In Progress');
  });

  it('allows resolve from In Progress', () => {
    const r = validateTransition('resolve', 'In Progress');
    expect(r.valid).toBe(true);
    expect(r.nextStatus).toBe('Resolved');
  });

  it('rejects claim when not New', () => {
    const r = validateTransition('claim', 'In Progress');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Cannot claim/);
  });

  it('rejects resolve when not In Progress', () => {
    const r = validateTransition('resolve', 'Awaiting Member');
    expect(r.valid).toBe(false);
  });

  it('rejects unknown action', () => {
    // @ts-expect-error testing unknown action
    const r = validateTransition('vanish', 'New');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Unknown action/);
  });
});

describe('validateResolvePayload', () => {
  const valid = {
    resolutionType: 'Fixed',
    resolutionNote: 'The AC unit was serviced and is now working correctly.',
    reporterContacted: true,
  };

  it('accepts valid payload', () => {
    expect(validateResolvePayload(valid).valid).toBe(true);
  });

  it('rejects invalid resolutionType', () => {
    const r = validateResolvePayload({ ...valid, resolutionType: 'Magic' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid resolutionType/);
  });

  it('rejects note shorter than 20 chars', () => {
    const r = validateResolvePayload({ ...valid, resolutionNote: 'Too short' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/20 characters/);
  });

  it('rejects when reporterContacted is false', () => {
    const r = validateResolvePayload({ ...valid, reporterContacted: false });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/reporterContacted/);
  });

  it('rejects when resolutionNote is missing', () => {
    const r = validateResolvePayload({ ...valid, resolutionNote: undefined });
    expect(r.valid).toBe(false);
  });

  it('RESOLUTION_TYPES contains all 6 expected values', () => {
    expect(RESOLUTION_TYPES).toContain('Fixed');
    expect(RESOLUTION_TYPES).toContain('Escalated');
    expect(RESOLUTION_TYPES).toContain('Refund Issued');
    expect(RESOLUTION_TYPES).toContain('Policy Explained');
    expect(RESOLUTION_TYPES).toContain('No Action Needed');
    expect(RESOLUTION_TYPES).toContain('Duplicate');
    expect(RESOLUTION_TYPES).toHaveLength(6);
  });
});

describe('edge-function constant sync', () => {
  // Reads the Deno edge function source and checks its RESOLUTION_TYPES Set
  // and TRANSITIONS object match src/lib/ticket-resolution.ts.
  // Fails if someone updates one copy but forgets the other.
  it('RESOLUTION_TYPES matches edge function copy', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('supabase/functions/ticket-resolve/index.ts', 'utf8');
    const match = src.match(/const RESOLUTION_TYPES = new Set\(\[([\s\S]*?)\]\)/);
    expect(match, 'RESOLUTION_TYPES not found in edge function').toBeTruthy();
    const edgeTypes = match![1]
      .split(',')
      .map(s => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(new Set(edgeTypes)).toEqual(new Set(RESOLUTION_TYPES));
  });

  it('TRANSITIONS actions match edge function copy', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('supabase/functions/ticket-resolve/index.ts', 'utf8');
    const edgeActions = ['claim', 'await_member', 'unblock', 'resolve'];
    for (const action of edgeActions) {
      expect(src).toContain(`${action}:`);
    }
  });
});
