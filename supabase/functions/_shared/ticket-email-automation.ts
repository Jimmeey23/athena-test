export type TicketEmailAutomationEventType =
  | 'ticket_assigned';

export type TicketEmailAutomationTicket = {
  id: string;
  assigned_to: string;
  created_at: string;
  updated_at?: string | null;
  sla_due_at: string;
  status: string;
};

export type TicketEmailAutomationJob = {
  eventType: TicketEmailAutomationEventType;
  eventKey: string;
  ticketId: string;
};

type BuildTicketEmailAutomationJobsInput = {
  tickets: TicketEmailAutomationTicket[];
  existingEventKeys: Set<string>;
  assignmentTicketIds?: Set<string>;
  now?: Date;
  timeZone?: string;
};

const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const CLOSED_STATUSES = new Set(['resolved', 'closed']);

export function ticketEmailAutomationZonedDateKey(
  value: string | Date,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return [part('year'), part('month'), part('day')].filter(Boolean).join('-');
}

export function isTicketEmailAutomationOpen(ticket: Pick<TicketEmailAutomationTicket, 'status'>): boolean {
  return !CLOSED_STATUSES.has(ticket.status.trim().toLowerCase());
}

export function ticketEmailAutomationEventKey(
  eventType: TicketEmailAutomationEventType,
  ticket: TicketEmailAutomationTicket,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  void timeZone;
  return `${eventType}:${ticket.id}:${ticket.assigned_to}:${ticket.created_at}`;
}

export function isTicketEmailAutomationDueToday(
  ticket: TicketEmailAutomationTicket,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): boolean {
  if (!isTicketEmailAutomationOpen(ticket)) return false;
  return Boolean(
    ticket.sla_due_at &&
      ticketEmailAutomationZonedDateKey(ticket.sla_due_at, timeZone) ===
        ticketEmailAutomationZonedDateKey(now, timeZone)
  );
}

export function buildTicketEmailAutomationJobs({
  tickets,
  existingEventKeys,
  assignmentTicketIds,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
}: BuildTicketEmailAutomationJobsInput): TicketEmailAutomationJob[] {
  const jobs: TicketEmailAutomationJob[] = [];

  for (const ticket of tickets) {
    if (!isTicketEmailAutomationOpen(ticket)) continue;

    const shouldSendAssignment = !assignmentTicketIds || assignmentTicketIds.has(ticket.id);
    const assignedKey = ticketEmailAutomationEventKey('ticket_assigned', ticket, timeZone);
    if (shouldSendAssignment && !existingEventKeys.has(assignedKey)) {
      jobs.push({
        eventType: 'ticket_assigned',
        eventKey: assignedKey,
        ticketId: ticket.id,
      });
    }

    void now;
    void timeZone;
  }

  return jobs;
}
