# Owner Resolution Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ticket owners a server-enforced resolution flow — claim, block on member, and resolve tickets — with an AI-rewritten email sent to the reporter and an in-app status update on resolution.

**Architecture:** Pure validation helpers in `src/lib/ticket-resolution.ts` (Vitest-tested). A new `ticket-resolve` Deno edge function validates ownership server-side, drives all status transitions, generates an AI-rewritten email via `callJsonAi`, and sends it via nodemailer SMTP (same pattern as `ticket-email-notifications`). `ResolveTicketDrawer.tsx` collects the resolution payload. An owner action bar is added to `TicketDetailDrawer`. The reporter sees their ticket update live via the existing Supabase realtime subscription.

**Tech Stack:** Vite + React + TypeScript, Vitest, Supabase Edge Functions (Deno), nodemailer@6.9.16, `callJsonAi` from `_shared/ai-provider.ts`, `invokeTicketingFunction` from `src/lib/ticketing-functions.ts`.

## Global Constraints

- Resolution note min length: 20 characters
- Resolution types: `Fixed | Escalated | Refund Issued | Policy Explained | No Action Needed | Duplicate`
- Valid transitions server-side only: `New→In Progress` (claim), `In Progress→Awaiting Member`, `Awaiting Member→In Progress`, `In Progress→Resolved`
- Only assigned owner can drive transitions (enforced in edge function, JWT-verified)
- AI rewrite failure must NOT block resolution — fall back to raw note
- SMTP env vars: `MAILTRAP_SMTP_HOST`, `MAILTRAP_SMTP_PORT`, `MAILTRAP_SMTP_USER`, `MAILTRAP_SMTP_PASS`, `MAILTRAP_FROM_EMAIL`, `MAILTRAP_FROM_NAME`
- Reporter email resolved via `supabase.auth.admin.getUserById(ticket.created_by)`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/ticket-resolution.ts` | Shared types, RESOLUTION_TYPES, validateTransition, validateResolvePayload |
| Create | `src/lib/ticket-resolution.test.ts` | Vitest unit tests for helpers |
| Create | `supabase/functions/ticket-resolve/index.ts` | Edge function: auth, ownership, transitions, AI rewrite, email |
| Create | `src/components/ticketing/ResolveTicketDrawer.tsx` | Resolution form drawer (type, note, checkbox) |
| Modify | `src/components/ticketing/TicketDetailDrawer.tsx` | Owner action bar: Claim / Awaiting Member / Resolve buttons |
| Modify | `src/components/ticketing/TicketCard.tsx` | Colour tokens for `Awaiting Member` and `Resolved` badges |

---

### Task 1: Shared Types + Validation Helpers

**Files:**
- Create: `src/lib/ticket-resolution.ts`
- Create: `src/lib/ticket-resolution.test.ts`

**Interfaces:**
- Produces: `RESOLUTION_TYPES`, `ResolutionType`, `ResolveAction`, `ResolveTicketPayload`, `ResolveTicketResponse`, `validateTransition()`, `validateResolvePayload()`

- [ ] **Step 1: Create `src/lib/ticket-resolution.ts`**

```typescript
export const RESOLUTION_TYPES = [
  'Fixed',
  'Escalated',
  'Refund Issued',
  'Policy Explained',
  'No Action Needed',
  'Duplicate',
] as const;

export type ResolutionType = typeof RESOLUTION_TYPES[number];
export type ResolveAction = 'claim' | 'await_member' | 'unblock' | 'resolve';
export type TicketStatus = 'New' | 'In Progress' | 'Awaiting Member' | 'Resolved' | 'Closed';

const TRANSITIONS: Record<ResolveAction, { from: TicketStatus; to: TicketStatus }> = {
  claim:        { from: 'New',              to: 'In Progress' },
  await_member: { from: 'In Progress',      to: 'Awaiting Member' },
  unblock:      { from: 'Awaiting Member',  to: 'In Progress' },
  resolve:      { from: 'In Progress',      to: 'Resolved' },
};

export function validateTransition(
  action: ResolveAction,
  currentStatus: string,
): { valid: boolean; error?: string; nextStatus?: TicketStatus } {
  const t = TRANSITIONS[action];
  if (!t) return { valid: false, error: `Unknown action: ${action}` };
  if (currentStatus !== t.from) {
    return {
      valid: false,
      error: `Cannot ${action} a ticket with status "${currentStatus}". Expected "${t.from}".`,
    };
  }
  return { valid: true, nextStatus: t.to };
}

export function validateResolvePayload(payload: {
  resolutionType?: string;
  resolutionNote?: string;
  reporterContacted?: boolean;
}): { valid: boolean; error?: string } {
  if (
    !payload.resolutionType ||
    !(RESOLUTION_TYPES as readonly string[]).includes(payload.resolutionType)
  ) {
    return { valid: false, error: `Invalid resolutionType. Must be one of: ${RESOLUTION_TYPES.join(', ')}.` };
  }
  if (!payload.resolutionNote || payload.resolutionNote.trim().length < 20) {
    return { valid: false, error: 'resolutionNote must be at least 20 characters.' };
  }
  if (!payload.reporterContacted) {
    return { valid: false, error: 'reporterContacted must be true.' };
  }
  return { valid: true };
}

export interface ResolveTicketPayload {
  ticketId: string;
  action: ResolveAction;
  resolutionType?: ResolutionType;
  resolutionNote?: string;
  reporterContacted?: boolean;
}

export interface ResolveTicketResponse {
  ticket: Record<string, unknown>;
  emailSent: boolean;
}
```

- [ ] **Step 2: Create `src/lib/ticket-resolution.test.ts`**

```typescript
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
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/lib/ticket-resolution.test.ts --run
```

Expected: all 11 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ticket-resolution.ts src/lib/ticket-resolution.test.ts
git commit -m "feat: add ticket resolution types and validation helpers"
```

---

### Task 2: `ticket-resolve` Edge Function — Non-Resolve Actions (claim, await_member, unblock)

**Files:**
- Create: `supabase/functions/ticket-resolve/index.ts`

**Interfaces:**
- Consumes: `TRANSITIONS` logic (inline — no import from frontend lib, Deno has no access to src/)
- Produces: `POST /ticket-resolve` → `{ ticket, emailSent: false }` for claim/await_member/unblock

- [ ] **Step 1: Create `supabase/functions/ticket-resolve/index.ts`**

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { callJsonAi } from '../_shared/ai-provider.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESOLUTION_TYPES = new Set([
  'Fixed', 'Escalated', 'Refund Issued', 'Policy Explained', 'No Action Needed', 'Duplicate',
]);

type TicketStatus = 'New' | 'In Progress' | 'Awaiting Member' | 'Resolved' | 'Closed';
type ResolveAction = 'claim' | 'await_member' | 'unblock' | 'resolve';

const TRANSITIONS: Record<ResolveAction, { from: TicketStatus; to: TicketStatus }> = {
  claim:        { from: 'New',             to: 'In Progress' },
  await_member: { from: 'In Progress',     to: 'Awaiting Member' },
  unblock:      { from: 'Awaiting Member', to: 'In Progress' },
  resolve:      { from: 'In Progress',     to: 'Resolved' },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function bearerToken(authorization: string): string {
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

function optionalEnv(...names: string[]): string {
  for (const name of names) {
    const v = Deno.env.get(name);
    if (v) return v;
  }
  return '';
}

function smtpTransport() {
  const port = Number(optionalEnv('MAILTRAP_SMTP_PORT', 'SMTP_PORT') || 2525);
  return nodemailer.createTransport({
    host: Deno.env.get('MAILTRAP_SMTP_HOST') || '',
    port,
    auth: {
      user: Deno.env.get('MAILTRAP_SMTP_USER') || '',
      pass: Deno.env.get('MAILTRAP_SMTP_PASS') || '',
    },
  });
}

async function rewriteResolutionEmail(
  ticketTitle: string,
  resolutionType: string,
  resolutionNote: string,
): Promise<string> {
  const result = await callJsonAi(
    (name) => Deno.env.get(name) || undefined,
    fetch,
    {
      temperature: 0.3,
      maxTokens: 300,
      systemContent: [
        'You are writing a brief, warm, professional resolution email on behalf of Physique 57 India.',
        'Rewrite the following internal resolution note as a 2-3 sentence member-facing message.',
        'Be specific about what was done. Do not reveal internal routing, assignee names, or ticket IDs.',
        'Sign off as "The Physique 57 India Team".',
        'Return JSON only: {"emailBody": string}',
      ].join('\n'),
      userContent: JSON.stringify({ ticketTitle, resolutionType, resolutionNote }),
    },
  );
  if (!result) return resolutionNote;
  try {
    const parsed = JSON.parse(result.content);
    return typeof parsed.emailBody === 'string' && parsed.emailBody.trim()
      ? parsed.emailBody
      : resolutionNote;
  } catch {
    return resolutionNote;
  }
}

async function sendResolutionEmail(
  toEmail: string,
  ticketTitle: string,
  emailBody: string,
): Promise<boolean> {
  const fromEmail = optionalEnv('MAILTRAP_FROM_EMAIL', 'SMTP_FROM_EMAIL') || 'athena@physique57india.com';
  const fromName = optionalEnv('MAILTRAP_FROM_NAME', 'SMTP_FROM_NAME') || 'Physique 57 India';
  try {
    await smtpTransport().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: toEmail,
      subject: `Your report has been resolved: ${ticketTitle}`,
      text: emailBody,
    });
    return true;
  } catch (err) {
    console.warn('[ticket-resolve] Email send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('TICKETING_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('TICKETING_SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceRoleKey = Deno.env.get('TICKETING_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Missing Supabase configuration' }, 500);
    }

    const token = bearerToken(request.headers.get('authorization') || '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);
    const authUser = userData.user;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await request.json() as {
      ticketId?: string;
      action?: string;
      resolutionType?: string;
      resolutionNote?: string;
      reporterContacted?: boolean;
    };

    const { ticketId, action } = body;
    if (!ticketId || !action) return json({ error: 'ticketId and action are required' }, 400);
    if (!TRANSITIONS[action as ResolveAction]) return json({ error: `Unknown action: ${action}` }, 400);

    // Fetch ticket
    const { data: ticket, error: fetchError } = await admin
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();
    if (fetchError || !ticket) return json({ error: 'Ticket not found' }, 404);

    // Ownership check (claim is exempt — anyone can claim a New ticket)
    if (action !== 'claim' && ticket.assigned_to !== authUser.email && ticket.assigned_to !== authUser.id) {
      return json({ error: 'Only the assigned owner can perform this action' }, 403);
    }

    // Transition validation
    const t = TRANSITIONS[action as ResolveAction];
    if (ticket.status !== t.from) {
      return json({
        error: `Cannot ${action} a ticket with status "${ticket.status}". Expected "${t.from}".`,
      }, 400);
    }

    // Already resolved/closed guard
    if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
      return json({ error: 'Ticket is already resolved or closed' }, 409);
    }

    // ── RESOLVE ACTION ──────────────────────────────────────────────
    if (action === 'resolve') {
      const { resolutionType, resolutionNote, reporterContacted } = body;

      if (!resolutionType || !RESOLUTION_TYPES.has(resolutionType)) {
        return json({ error: `Invalid resolutionType. Must be one of: ${[...RESOLUTION_TYPES].join(', ')}.` }, 400);
      }
      if (!resolutionNote || resolutionNote.trim().length < 20) {
        return json({ error: 'resolutionNote must be at least 20 characters.' }, 400);
      }
      if (!reporterContacted) {
        return json({ error: 'reporterContacted must be true.' }, 400);
      }

      const now = new Date().toISOString();
      const resolutionMeta = {
        type: resolutionType,
        note: resolutionNote.trim(),
        contactedReporter: true,
        resolvedAt: now,
        resolvedBy: authUser.email || authUser.id,
      };

      const existingMeta = ticket.metadata && typeof ticket.metadata === 'object' ? ticket.metadata : {};
      const { data: updated, error: updateError } = await admin
        .from('tickets')
        .update({ status: 'Resolved', metadata: { ...existingMeta, resolution: resolutionMeta } })
        .eq('id', ticketId)
        .select('*')
        .single();

      if (updateError || !updated) {
        return json({ error: updateError?.message || 'Failed to update ticket' }, 500);
      }

      await admin.from('ticket_events').insert({
        ticket_id: ticketId,
        event_type: 'status_changed',
        actor: authUser.email || authUser.id,
        from_value: 'In Progress',
        to_value: 'Resolved',
        metadata: { resolutionType, resolvedBy: authUser.email || authUser.id },
        created_by: authUser.id,
      });

      // Email reporter
      let emailSent = false;
      const reporterUid = ticket.created_by as string | null;
      if (reporterUid) {
        const { data: reporterData } = await admin.auth.admin.getUserById(reporterUid);
        const reporterEmail = reporterData?.user?.email;
        if (reporterEmail) {
          const emailBody = await rewriteResolutionEmail(ticket.title, resolutionType, resolutionNote);
          emailSent = await sendResolutionEmail(reporterEmail, ticket.title, emailBody);
          if (!emailSent) {
            console.warn(`[ticket-resolve] Email failed for ticket ${ticketId} → ${reporterEmail}`);
          }
        }
      }

      return json({ ticket: updated, emailSent });
    }

    // ── CLAIM / AWAIT_MEMBER / UNBLOCK ───────────────────────────────
    const patch: Record<string, unknown> = { status: t.to };
    if (action === 'claim') patch.assigned_to = authUser.email || authUser.id;

    const { data: updated, error: updateError } = await admin
      .from('tickets')
      .update(patch)
      .eq('id', ticketId)
      .select('*')
      .single();

    if (updateError || !updated) {
      return json({ error: updateError?.message || 'Failed to update ticket' }, 500);
    }

    await admin.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: 'status_changed',
      actor: authUser.email || authUser.id,
      from_value: t.from,
      to_value: t.to,
      metadata: { action },
      created_by: authUser.id,
    });

    return json({ ticket: updated, emailSent: false });

  } catch (err) {
    console.error('[ticket-resolve] Unhandled error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
```

- [ ] **Step 2: Run full test suite to confirm nothing broken**

```bash
npm test -- --run
```

Expected: all existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ticket-resolve/index.ts
git commit -m "feat: add ticket-resolve edge function"
```

---

### Task 3: `ResolveTicketDrawer.tsx` Component

**Files:**
- Create: `src/components/ticketing/ResolveTicketDrawer.tsx`

**Interfaces:**
- Consumes: `RESOLUTION_TYPES`, `ResolveTicketPayload`, `ResolveTicketResponse` from `src/lib/ticket-resolution.ts`; `invokeTicketingFunction` from `src/lib/ticketing-functions.ts`; `Ticket` from `@/lib/ticketing-data`
- Produces: `<ResolveTicketDrawer ticket={Ticket} open={boolean} onClose={() => void} onResolved={(ticket) => void} />`

- [ ] **Step 1: Create `src/components/ticketing/ResolveTicketDrawer.tsx`**

```tsx
import React, { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { RESOLUTION_TYPES, ResolveTicketPayload, ResolveTicketResponse } from '@/lib/ticket-resolution';
import { invokeTicketingFunction } from '@/lib/ticketing-functions';
import type { Ticket } from '@/lib/ticketing-data';

interface Props {
  ticket: Ticket;
  open: boolean;
  onClose: () => void;
  onResolved: (updated: Record<string, unknown>) => void;
}

export function ResolveTicketDrawer({ ticket, open, onClose, onResolved }: Props) {
  const [resolutionType, setResolutionType] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [reporterContacted, setReporterContacted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailWarning, setEmailWarning] = useState(false);

  if (!open) return null;

  const noteLength = resolutionNote.trim().length;
  const canSubmit = resolutionType && noteLength >= 20 && reporterContacted && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    setEmailWarning(false);

    const payload: ResolveTicketPayload = {
      ticketId: ticket.id,
      action: 'resolve',
      resolutionType: resolutionType as ResolveTicketPayload['resolutionType'],
      resolutionNote: resolutionNote.trim(),
      reporterContacted: true,
    };

    const { data, error: invokeError } = await invokeTicketingFunction<ResolveTicketResponse>(
      'ticket-resolve',
      { body: payload },
    );

    setLoading(false);

    if (invokeError) {
      setError(invokeError.message || 'Failed to resolve ticket. Try again.');
      return;
    }

    if (data && !data.emailSent) {
      setEmailWarning(true);
    }

    if (data?.ticket) {
      onResolved(data.ticket);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h2 className="text-base font-semibold">Resolve Ticket</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Ticket title (read-only context) */}
          <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2">{ticket.title}</p>

          {/* Resolution type */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Resolution type <span className="text-red-500">*</span>
            </label>
            <select
              value={resolutionType}
              onChange={(e) => setResolutionType(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            >
              <option value="">Select a resolution type…</option>
              {RESOLUTION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Resolution note */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Resolution note <span className="text-red-500">*</span>
            </label>
            <textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              rows={4}
              placeholder="Describe what was done to resolve this issue (min 20 characters)…"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              required
            />
            <p className={`text-xs text-right ${noteLength < 20 ? 'text-zinc-400' : 'text-emerald-500'}`}>
              {noteLength} / 20 min
            </p>
          </div>

          {/* Reporter contacted checkbox */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={reporterContacted}
              onChange={(e) => setReporterContacted(e.target.checked)}
              className="mt-0.5 rounded border-zinc-300 text-emerald-500 focus:ring-emerald-500"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              I have contacted or notified the reporter about this resolution
            </span>
          </label>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Email warning (shown briefly after submit) */}
          {emailWarning && (
            <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              Ticket resolved, but the reporter email failed to send — please notify them manually.
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1 pb-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 text-sm font-medium transition-colors"
            >
              {loading ? 'Resolving…' : 'Mark as Resolved'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build to verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds, no TypeScript errors referencing `ResolveTicketDrawer`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ticketing/ResolveTicketDrawer.tsx
git commit -m "feat: add ResolveTicketDrawer component"
```

---

### Task 4: Owner Action Bar in `TicketDetailDrawer`

**Files:**
- Modify: `src/components/ticketing/TicketDetailDrawer.tsx`

**Interfaces:**
- Consumes: `<ResolveTicketDrawer>` from `./ResolveTicketDrawer`; `invokeTicketingFunction` from `@/lib/ticketing-functions`; `useBackendAuth` from `@/contexts/useBackendAuth`; `Ticket` type from `@/lib/ticketing-data`

- [ ] **Step 1: Add import for `ResolveTicketDrawer` and `useBackendAuth` at top of `TicketDetailDrawer.tsx`**

Find the existing import block. Add these two imports:

```typescript
import { ResolveTicketDrawer } from './ResolveTicketDrawer';
import { useBackendAuth } from '@/contexts/useBackendAuth';
```

- [ ] **Step 2: Add `useBackendAuth` hook call inside the component**

Find where other hooks are called (near the top of the component function body, after the props destructuring). Add:

```typescript
const { user } = useBackendAuth();
```

- [ ] **Step 3: Add `resolveDrawerOpen` state**

Near the other `useState` calls in the component, add:

```typescript
const [resolveDrawerOpen, setResolveDrawerOpen] = useState(false);
```

- [ ] **Step 4: Add `isOwner` and `actionLoading` helpers**

After the hook calls, add:

```typescript
const isOwner =
  !!user &&
  !!ticket.assigned_to &&
  (ticket.assigned_to === user.email || ticket.assigned_to === user.id);

const [actionLoading, setActionLoading] = useState<string | null>(null);

async function handleQuickAction(action: 'claim' | 'await_member' | 'unblock') {
  setActionLoading(action);
  const { error } = await invokeTicketingFunction('ticket-resolve', {
    body: { ticketId: ticket.id, action },
  });
  setActionLoading(null);
  if (error) {
    console.error('[TicketDetailDrawer] quick action error:', error.message);
  }
}
```

- [ ] **Step 5: Add the owner action bar JSX**

Find the closing `</div>` or `</div>` at the bottom of the drawer's content area (just before the drawer wrapper closes). Insert the action bar before it:

```tsx
{/* Owner action bar */}
{(ticket.status === 'New' || isOwner) && (
  <div className="sticky bottom-0 bg-white dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 flex gap-2">
    {ticket.status === 'New' && (
      <button
        onClick={() => handleQuickAction('claim')}
        disabled={actionLoading === 'claim'}
        className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
      >
        {actionLoading === 'claim' ? 'Claiming…' : 'Claim Ticket'}
      </button>
    )}
    {isOwner && ticket.status === 'In Progress' && (
      <>
        <button
          onClick={() => handleQuickAction('await_member')}
          disabled={!!actionLoading}
          className="flex-1 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 text-sm font-medium py-2 transition-colors"
        >
          {actionLoading === 'await_member' ? 'Updating…' : 'Awaiting Member'}
        </button>
        <button
          onClick={() => setResolveDrawerOpen(true)}
          className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 transition-colors"
        >
          Resolve
        </button>
      </>
    )}
    {isOwner && ticket.status === 'Awaiting Member' && (
      <button
        onClick={() => handleQuickAction('unblock')}
        disabled={!!actionLoading}
        className="flex-1 rounded-lg border border-blue-300 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 text-sm font-medium py-2 transition-colors"
      >
        {actionLoading === 'unblock' ? 'Updating…' : 'Member Responded — Unblock'}
      </button>
    )}
  </div>
)}

{/* Resolution drawer */}
<ResolveTicketDrawer
  ticket={ticket}
  open={resolveDrawerOpen}
  onClose={() => setResolveDrawerOpen(false)}
  onResolved={(_updated) => {
    setResolveDrawerOpen(false);
  }}
/>
```

- [ ] **Step 6: Add missing `invokeTicketingFunction` import if not already present**

Check the top of the file — `invokeTicketingFunction` is in `@/lib/ticketing-functions`. Add it if missing:

```typescript
import { invokeTicketingFunction } from '@/lib/ticketing-functions';
```

- [ ] **Step 7: Run build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/ticketing/TicketDetailDrawer.tsx
git commit -m "feat: add owner action bar to TicketDetailDrawer"
```

---

### Task 5: Status Badge Colours + Reporter Realtime Notification

**Files:**
- Modify: `src/components/ticketing/TicketCard.tsx`

**Interfaces:**
- Consumes: existing status badge colour logic in `TicketCard.tsx`

- [ ] **Step 1: Find and update status colour map in `TicketCard.tsx`**

Search for the status colour/badge logic:

```bash
grep -n "In Progress\|Awaiting\|Resolved\|status.*color\|status.*bg\|statusColor\|statusBg" src/components/ticketing/TicketCard.tsx | head -20
```

Find the object or switch/ternary that maps status → colour classes. Add (or update) entries for `Awaiting Member` and `Resolved`:

```typescript
// In whichever colour map/function exists, ensure these are present:
// 'New'            → blue variant   (likely already there)
// 'In Progress'    → indigo/purple  (likely already there)
// 'Awaiting Member'→ amber/orange
// 'Resolved'       → emerald/green
// 'Closed'         → zinc/grey      (likely already there)

// Typical shape to find and extend:
const STATUS_COLOURS: Record<string, string> = {
  'New':             'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'In Progress':     'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  'Awaiting Member': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Resolved':        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'Closed':          'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};
```

Match whatever variable name and class-string style already exists — do NOT replace the entire file, only add the two missing entries.

- [ ] **Step 2: Run build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ticketing/TicketCard.tsx
git commit -m "feat: add Awaiting Member and Resolved status badge colours"
```

---

## Post-Implementation Smoke Test

After all tasks are complete, verify end-to-end manually:

1. Log in as a staff member. Create a ticket via Athena chat. Confirm it appears as `New`.
2. Open the ticket detail drawer. Confirm "Claim Ticket" button is visible.
3. Click "Claim" — confirm status changes to `In Progress` and action bar updates.
4. Click "Awaiting Member" — confirm status changes to `Awaiting Member`.
5. Click "Member Responded — Unblock" — confirm status returns to `In Progress`.
6. Click "Resolve" — confirm `ResolveTicketDrawer` opens.
7. Fill in resolution type, a note ≥ 20 chars, check the checkbox. Submit.
8. Confirm ticket status changes to `Resolved` in dashboard and drawer.
9. Confirm reporter receives email (check Mailtrap inbox).
10. Confirm `ticket_events` row was inserted (Supabase table editor).
