import { describe, expect, it } from 'vitest';
import { canAccessTicket, canEditTicketResolution, canUpdateTicketStatus } from './ticket-permissions';

describe('ticket status permissions', () => {
  it('allows admins to update any ticket status', () => {
    expect(
      canUpdateTicketStatus({
        accessRole: 'admin',
        identityValues: new Set(['frontdesk@physique57india.com']),
        ticket: { assignedTo: 'Anisha Shah' },
      })
    ).toBe(true);
  });

  it('allows the assigned owner to update status by name', () => {
    expect(
      canUpdateTicketStatus({
        accessRole: 'support',
        identityValues: new Set(['anisha shah']),
        ticket: { assignedTo: 'Anisha Shah' },
      })
    ).toBe(true);
  });

  it('allows the assigned owner to update status by employee email', () => {
    expect(
      canUpdateTicketStatus({
        accessRole: 'support',
        identityValues: new Set(['anisha@physique57india.com']),
        ticket: { assignedTo: 'Anisha Shah' },
      })
    ).toBe(true);
  });

  it('blocks support users who are not the assigned owner', () => {
    expect(
      canUpdateTicketStatus({
        accessRole: 'support',
        identityValues: new Set(['operations@physique57india.com', 'zahur shaikh']),
        ticket: { assignedTo: 'Anisha Shah' },
      })
    ).toBe(false);
  });
});

describe('ticket visibility permissions', () => {
  it('allows admins to see every ticket', () => {
    expect(
      canAccessTicket({
        accessRole: 'admin',
        identityValues: new Set(['frontdesk@physique57india.com']),
        ticket: { createdBy: 'someone-else', assignedTo: 'Anisha Shah', reportedBy: 'Someone Else' },
      })
    ).toBe(true);
  });

  it('allows support users to see tickets they created', () => {
    expect(
      canAccessTicket({
        accessRole: 'support',
        identityValues: new Set(['user-123']),
        ticket: { createdBy: 'user-123', assignedTo: 'Anisha Shah' },
      })
    ).toBe(true);
  });

  it('allows support users to see tickets assigned to their employee email', () => {
    expect(
      canAccessTicket({
        accessRole: 'support',
        identityValues: new Set(['anisha@physique57india.com']),
        ticket: { assignedTo: 'Anisha Shah' },
      })
    ).toBe(true);
  });

  it('blocks unrelated support users', () => {
    expect(
      canAccessTicket({
        accessRole: 'support',
        identityValues: new Set(['operations@physique57india.com']),
        ticket: { createdBy: 'user-123', assignedTo: 'Anisha Shah', reportedBy: 'Priya' },
      })
    ).toBe(false);
  });
});

describe('ticket resolution plan permissions', () => {
  it('allows the escalation manager to edit the resolution plan', () => {
    expect(
      canEditTicketResolution({
        accessRole: 'support',
        identityValues: new Set(['saachi shetty']),
        ticket: { assignedTo: 'Zahur Shaikh' },
      })
    ).toBe(true);
  });

  it('blocks unrelated support users from editing the resolution plan', () => {
    expect(
      canEditTicketResolution({
        accessRole: 'support',
        identityValues: new Set(['frontdesk@physique57india.com']),
        ticket: { assignedTo: 'Zahur Shaikh' },
      })
    ).toBe(false);
  });
});
