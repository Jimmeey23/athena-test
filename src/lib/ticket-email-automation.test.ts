import { describe, expect, it } from 'vitest';
import {
  buildTicketEmailAutomationJobs,
  ticketEmailAutomationEventKey,
  TicketEmailAutomationTicket,
} from '../../supabase/functions/_shared/ticket-email-automation.ts';

const baseTicket: TicketEmailAutomationTicket = {
  id: 'P57-NEW001',
  assigned_to: 'Imran Shaikh',
  created_at: '2026-05-25T03:30:00.000Z',
  updated_at: '2026-05-25T03:30:00.000Z',
  sla_due_at: '2026-05-25T12:00:00.000Z',
  status: 'New',
};

describe('ticket email automation dispatch rules', () => {
  it('selects only idempotent assignment jobs for new tickets', () => {
    const jobs = buildTicketEmailAutomationJobs({
      tickets: [baseTicket],
      existingEventKeys: new Set(),
      now: new Date('2026-05-25T04:00:00.000Z'),
      timeZone: 'Asia/Kolkata',
    });

    expect(jobs).toEqual([
      {
        eventType: 'ticket_assigned',
        eventKey: 'ticket_assigned:P57-NEW001:Imran Shaikh:2026-05-25T03:30:00.000Z',
        ticketId: 'P57-NEW001',
      },
    ]);
  });

  it('skips jobs that already have audit event keys', () => {
    const assignedKey = ticketEmailAutomationEventKey('ticket_assigned', baseTicket);

    const jobs = buildTicketEmailAutomationJobs({
      tickets: [baseTicket],
      existingEventKeys: new Set([assignedKey]),
      now: new Date('2026-05-25T04:00:00.000Z'),
      timeZone: 'Asia/Kolkata',
    });

    expect(jobs).toEqual([]);
  });

  it('does not select lifecycle jobs for resolved or closed tickets', () => {
    const jobs = buildTicketEmailAutomationJobs({
      tickets: [
        { ...baseTicket, id: 'P57-RESOLVED', status: 'Resolved' },
        { ...baseTicket, id: 'P57-CLOSED', status: 'Closed' },
      ],
      existingEventKeys: new Set(),
      now: new Date('2026-05-25T04:00:00.000Z'),
      timeZone: 'Asia/Kolkata',
    });

    expect(jobs).toEqual([]);
  });

  it('limits assignment jobs to recent tickets while still allowing SLA pre-warning jobs for older open tickets', () => {
    const olderDueToday = { ...baseTicket, id: 'P57-OLDER001', created_at: '2026-05-20T03:30:00.000Z' };

    const jobs = buildTicketEmailAutomationJobs({
      tickets: [baseTicket, olderDueToday],
      assignmentTicketIds: new Set([baseTicket.id]),
      existingEventKeys: new Set(),
      now: new Date('2026-05-25T04:00:00.000Z'),
      timeZone: 'Asia/Kolkata',
    });

    expect(jobs.map((job) => job.eventKey)).toEqual([
      'ticket_assigned:P57-NEW001:Imran Shaikh:2026-05-25T03:30:00.000Z',
      'ticket_sla_pre_warning:P57-OLDER001:Imran Shaikh:2026-05-20T03:30:00.000Z:2026-05-25T12:00:00.000Z',
    ]);
  });

  it('creates an SLA pre-warning job once 75 percent of the SLA window has elapsed', () => {
    const warningTicket: TicketEmailAutomationTicket = {
      ...baseTicket,
      id: 'P57-SLA001',
      created_at: '2026-05-25T00:00:00.000Z',
      sla_due_at: '2026-05-25T08:00:00.000Z',
    };

    const jobs = buildTicketEmailAutomationJobs({
      tickets: [warningTicket],
      assignmentTicketIds: new Set(),
      existingEventKeys: new Set(),
      now: new Date('2026-05-25T06:00:00.000Z'),
      timeZone: 'Asia/Kolkata',
    });

    expect(jobs).toEqual([
      {
        eventType: 'ticket_sla_pre_warning',
        eventKey: 'ticket_sla_pre_warning:P57-SLA001:Imran Shaikh:2026-05-25T00:00:00.000Z:2026-05-25T08:00:00.000Z',
        ticketId: 'P57-SLA001',
      },
    ]);
  });

  it('does not create an SLA pre-warning before 75 percent elapsed or after the audit key exists', () => {
    const warningTicket: TicketEmailAutomationTicket = {
      ...baseTicket,
      id: 'P57-SLA002',
      created_at: '2026-05-25T00:00:00.000Z',
      sla_due_at: '2026-05-25T08:00:00.000Z',
    };
    const warningKey = ticketEmailAutomationEventKey('ticket_sla_pre_warning', warningTicket);

    expect(buildTicketEmailAutomationJobs({
      tickets: [warningTicket],
      assignmentTicketIds: new Set(),
      existingEventKeys: new Set(),
      now: new Date('2026-05-25T05:59:59.000Z'),
      timeZone: 'Asia/Kolkata',
    })).toEqual([]);

    expect(buildTicketEmailAutomationJobs({
      tickets: [warningTicket],
      assignmentTicketIds: new Set(),
      existingEventKeys: new Set([warningKey]),
      now: new Date('2026-05-25T06:30:00.000Z'),
      timeZone: 'Asia/Kolkata',
    })).toEqual([]);
  });
});
