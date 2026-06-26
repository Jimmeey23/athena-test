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
