# Owner Resolution Workflow — Design Spec
**Date:** 2026-06-26
**Status:** Approved

## Goal
Give ticket owners a structured, server-enforced resolution flow. When a ticket is resolved, the reporter receives an in-app status update and an AI-rewritten email summarising what was done.

## Decisions
- Reporter notification: in-app realtime update + AI-summarised Mailtrap email
- Status machine: `New → In Progress → Awaiting Member → Resolved → Closed`
- Who can resolve: assigned owner only (enforced server-side)
- Resolution requires: resolution type + resolution note (min 20 chars) + reporter-contacted confirmation
- Email copy: Athena rewrites owner's resolution note into member-friendly language; falls back to raw note on AI failure

---

## Architecture

### New Edge Function: `ticket-resolve`

**Endpoint:** `POST /ticket-resolve`

**Request payload:**
```json
{
  "ticketId": "uuid",
  "action": "claim" | "await_member" | "unblock" | "resolve",
  "resolutionType": "Fixed|Escalated|Refund Issued|Policy Explained|No Action Needed|Duplicate",
  "resolutionNote": "string (min 20 chars, required for resolve action)",
  "reporterContacted": true
}
```

**Flow for `resolve` action:**
1. Validate JWT → extract `authUser.id`
2. Fetch ticket — 404 if not found
3. Check `ticket.assigned_to === authUser.id` → 403 if not owner
4. Validate transition: `In Progress → Resolved` only → 400 for invalid transitions
5. Update `tickets`: `status='Resolved'`, merge into `metadata.resolution = { type, note, contactedReporter: true, resolvedAt, resolvedBy }`
6. Insert `ticket_events`: `{ event_type: 'status_changed', from_value: 'In Progress', to_value: 'Resolved', actor: authUser.email, metadata: { resolutionType, resolvedBy } }`
7. Call Athena AI to rewrite `resolutionNote` into member-friendly email body (temperature 0.3, max 200 tokens) — fall back to raw note on failure
8. Look up reporter email: `supabase.auth.admin.getUserById(ticket.created_by)` → extract `user.email`
9. Send email via Mailtrap SMTP to reporter's email address
10. Return `{ ticket, emailSent: boolean }`

**Flow for `claim` action (`New → In Progress`):**
- Validates ticket is `New` and unowned or owned by caller
- Sets `assigned_to = authUser.id`, `status = 'In Progress'`
- Inserts ticket_event

**Flow for `await_member` / `unblock`:**
- `In Progress → Awaiting Member` / `Awaiting Member → In Progress`
- No email, no resolution data required

**Valid status transitions (server-enforced):**
| From | To | Action |
|------|----|--------|
| New | In Progress | claim |
| In Progress | Awaiting Member | await_member |
| Awaiting Member | In Progress | unblock |
| In Progress | Resolved | resolve |

`Resolved → Closed` is deferred (manager action or auto after 48h, future feature).

---

## Frontend Components

### `ResolveTicketDrawer.tsx` (new)
Slides in from `TicketDetailDrawer` when owner clicks "Resolve".

**Fields:**
- Status selector — only shows valid next states for current ticket status
- Resolution type — dropdown: `Fixed | Escalated | Refund Issued | Policy Explained | No Action Needed | Duplicate`
- Resolution note — textarea, required, min 20 chars, character counter
- "I have contacted the reporter" — checkbox, must be checked to enable submit
- Submit button — calls `ticket-resolve` edge function, shows loading state
- Disabled entirely if `ticket.assigned_to !== currentUser.id`

### `TicketDetailDrawer.tsx` changes
Add owner action bar fixed at bottom of drawer:
- **"Claim"** — visible when `status === 'New'`, calls `claim` action inline (no drawer), instant optimistic update
- **"Awaiting Member"** toggle — visible when `status === 'In Progress'`, toggles `await_member` / `unblock`
- **"Resolve"** — visible when `status === 'In Progress'`, opens `ResolveTicketDrawer`
- All buttons hidden/disabled when `ticket.assigned_to !== currentUser.id`

### Dashboard / `TicketCard.tsx` changes
- Add colour tokens for `Awaiting Member` (amber) and `Resolved` (green) status badges
- No structural changes needed

### In-app notification
Reporter's ticket card updates via existing Supabase realtime subscription on ticket status change. Reporter sees toast: "Your ticket '[title]' has been resolved."

---

## Error Handling

| Scenario | Response | UX |
|----------|----------|----|
| Non-owner calls resolve | 403 | "Only the assigned owner can resolve this ticket" |
| Unassigned ticket | 400 | "Claim the ticket before resolving" |
| Invalid status transition | 400 | "Cannot resolve a ticket with status X" |
| Already resolved/closed | 409 | "Ticket already resolved" |
| Two owners claim simultaneously | 409 (second writer) | "Ticket already claimed by [name]" |
| AI rewrite fails | Proceed with raw note | Warning log, no user-facing error |
| Email send fails | Proceed, `emailSent: false` | Owner toast: "Ticket resolved but reporter email failed — notify manually" |
| `created_by` null or no auth email found | Skip email silently | Log in ticket_events |
| `reported_by` is "AI Intake" and no `created_by` | Skip email silently | No notification needed |
| Network error mid-submit | Drawer stays open | Error state with retry (idempotent on ticketId) |

---

## Data Model Changes

**`tickets` table — `metadata` shape additions:**
```json
{
  "resolution": {
    "type": "Fixed",
    "note": "Owner's raw note",
    "contactedReporter": true,
    "resolvedAt": "ISO timestamp",
    "resolvedBy": "user email"
  }
}
```

**`ticket_events` — new event types:**
- `status_changed` (already used, extended)
- `resolution_set`

No schema migrations needed — both use existing JSONB `metadata` columns.

---

## Email Template (AI-rewritten)

Athena prompt for rewrite:
> "You are writing a brief, warm, professional resolution email on behalf of Physique 57 India. Rewrite the following internal resolution note as a 2-3 sentence member-facing message. Be specific about what was done. Do not reveal internal routing or staff names. Sign off as 'The Physique 57 India Team'."

Fallback (AI unavailable): send raw resolution note with standard header/footer.

---

## Out of Scope (deferred)
- `Resolved → Closed` auto-transition (48h timer) — future escalation engine feature
- Manager override of ownership — future role-based permissions feature
- Member reply-to-resolution email thread — future
