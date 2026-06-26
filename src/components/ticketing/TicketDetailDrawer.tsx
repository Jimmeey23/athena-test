import React, { useEffect, useMemo, useState } from 'react';
import {
  Ticket,
  PRIORITY_SLA,
  STATUSES,
  ASSOCIATES,
  CATEGORIES,
  STUDIOS,
  TRAINERS,
  RESOLUTION_ESCALATION_OPTIONS,
  RESOLUTION_FOLLOW_UP_CHANNELS,
  RESOLUTION_MEMBER_RESPONSES,
  RESOLUTION_PATHWAYS,
  RESOLUTION_STAGES,
  getEscalationTarget,
} from '@/lib/ticketing-data';
import { buildTicketEditPatch } from '@/lib/ticket-editing';
import { canSelectStatusFromTicket, validateTicketStatusUpdate } from '@/lib/ticket-status-lifecycle';
import { TicketStatusUpdateInput } from './TicketContext';
import { useTickets } from './useTickets';
import { X, Clock, MapPin, User, Calendar, Tag, MessageSquare, Phone, Lock, Pencil, Save, Trash2, Link2, Plus } from 'lucide-react';
import { MomenceAutomationPanel } from './MomenceAutomationPanel';
import { backendSupabase } from '@/lib/backend-supabase';
import { MomenceMemberTicketField, MomenceSessionTicketField } from './MomenceTicketEntityFields';
import { buildResolutionAssistant } from '@/lib/smart-ops-intelligence';
import { invokeTicketingFunction } from '@/lib/ticketing-functions';
import { useBackendAuth } from '@/contexts/useBackendAuth';
import { ResolveTicketDrawer } from './ResolveTicketDrawer';

interface Props {
  ticket: Ticket | null;
  onClose: () => void;
}

interface TicketAttachmentRecord {
  path?: string;
  fileName?: string;
  contentType?: string;
  size?: number;
  publicUrl?: string;
  uploadedAt?: string;
}

function readTicketAttachments(ticket: Ticket): TicketAttachmentRecord[] {
  const raw = (ticket.metadata as Record<string, unknown> | undefined)?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is TicketAttachmentRecord => Boolean(entry && typeof entry === 'object'));
}

function defaultStatusValues(ticket?: Ticket | null): TicketStatusUpdateInput {
  return {
    status: ticket?.status || 'New',
    reason: '',
    actionTaken: '',
    actionDate: new Date().toISOString().slice(0, 10),
    followUps: [],
    comments: '',
    notes: '',
    resolutionSummary: '',
    outcome: '',
  };
}

function tagsFromInput(value: string): string[] {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function getDisplayResolutionSteps(ticket: Ticket, assistantSteps: string[]): string[] {
  const planned = stringArray(ticket.metadata?.resolutionPlan?.steps);
  if (planned.length) return planned;
  const recommended = stringArray(ticket.metadata?.recommendedResolutionSteps);
  if (recommended.length) return recommended;
  return stringArray(assistantSteps);
}

function stepsFromTextarea(value: string): string[] {
  return Array.from(new Set(
    value
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
  ));
}

function inferResolutionPathway(ticket: Ticket): string {
  const text = `${ticket.category} ${ticket.subCategory} ${ticket.description}`.toLowerCase();
  if (/billing|payment|refund|invoice|charge|package|membership/.test(text)) return 'Billing adjustment';
  if (/momence|booking|waitlist|class|session|attendance|check.?in/.test(text)) return 'Momence correction';
  if (/repair|maintenance|ac|hvac|clean|facility|equipment|studio tool/.test(text)) return 'Operations repair';
  if (/trainer|instructor|cue|class quality|music|form/.test(text)) return 'Training coaching';
  if (/partnership|hosted|event|influencer|partner/.test(text)) return 'Partnership follow-up';
  if (/policy|terms|rule|cancellation/.test(text)) return 'Policy clarification';
  return 'Member communication';
}

function defaultResolutionFields(ticket: Ticket) {
  const plan = ticket.metadata?.resolutionPlan;
  return {
    stage: plan?.stage || (ticket.status === 'Resolved' || ticket.status === 'Closed' ? 'Resolved pending confirmation' : 'Not started'),
    pathway: plan?.pathway || inferResolutionPathway(ticket),
    owner: plan?.owner || ticket.assignedTo,
    targetDate: plan?.targetDate || '',
    memberFollowUpChannel: plan?.memberFollowUpChannel || 'WhatsApp',
    memberResponse: plan?.memberResponse || 'Not captured',
    escalationNeeded: plan?.escalationNeeded || 'No escalation needed',
  };
}

function selectValues(values: readonly string[], current: string): string[] {
  return current && !values.includes(current) ? [current, ...values] : [...values];
}

export const TicketDetailDrawer: React.FC<Props> = ({ ticket, onClose }) => {
  const { updateTicket, updateTicketStatus, updateTicketResolutionPlan, canUpdateTicketStatus, canEditTicketResolution, deleteTicket } = useTickets();
  const { user } = useBackendAuth();
  const [editingLinkedContext, setEditingLinkedContext] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [resolutionSaving, setResolutionSaving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');
  const [resolutionStepsText, setResolutionStepsText] = useState('');
  const [resolutionOwnerNotes, setResolutionOwnerNotes] = useState('');
  const [resolutionStage, setResolutionStage] = useState('');
  const [resolutionPathway, setResolutionPathway] = useState('');
  const [resolutionOwner, setResolutionOwner] = useState('');
  const [resolutionTargetDate, setResolutionTargetDate] = useState('');
  const [resolutionFollowUpChannel, setResolutionFollowUpChannel] = useState('');
  const [resolutionMemberResponse, setResolutionMemberResponse] = useState('');
  const [resolutionEscalation, setResolutionEscalation] = useState('');
  const [editValues, setEditValues] = useState<Partial<Ticket>>({});
  const [resolveDrawerOpen, setResolveDrawerOpen] = useState(false);
  const [ticketOverride, setTicketOverride] = useState<typeof ticket | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusValues, setStatusValues] = useState<TicketStatusUpdateInput>(() => defaultStatusValues(ticket));
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const ticketAttachments = useMemo(() => ticket ? readTicketAttachments(ticket) : [], [ticket]);
  const resolutionAssistant = useMemo(() => ticket ? buildResolutionAssistant(ticket) : null, [ticket]);
  const resolutionSteps = useMemo(() => (
    ticket ? getDisplayResolutionSteps(ticket, resolutionAssistant?.nextActions || []) : []
  ), [resolutionAssistant?.nextActions, ticket]);
  const resolutionStepsKey = resolutionSteps.join('\n');
  const storedResolutionFields = useMemo(() => ticket ? defaultResolutionFields(ticket) : null, [ticket]);

  useEffect(() => {
    setEditingLinkedContext(false);
    setEditing(false);
    setEditValues(ticket || {});
    setEditError('');
    setStatusValues(defaultStatusValues(ticket));
    setStatusError('');
    setResolutionError('');
    setTicketOverride(null);
  }, [ticket]);

  useEffect(() => {
    setResolutionStepsText(resolutionStepsKey);
    setResolutionOwnerNotes(ticket?.metadata?.resolutionPlan?.ownerNotes || '');
    setResolutionStage(storedResolutionFields?.stage || '');
    setResolutionPathway(storedResolutionFields?.pathway || '');
    setResolutionOwner(storedResolutionFields?.owner || '');
    setResolutionTargetDate(storedResolutionFields?.targetDate || '');
    setResolutionFollowUpChannel(storedResolutionFields?.memberFollowUpChannel || '');
    setResolutionMemberResponse(storedResolutionFields?.memberResponse || '');
    setResolutionEscalation(storedResolutionFields?.escalationNeeded || '');
    setResolutionError('');
  }, [
    resolutionStepsKey,
    storedResolutionFields?.escalationNeeded,
    storedResolutionFields?.memberFollowUpChannel,
    storedResolutionFields?.memberResponse,
    storedResolutionFields?.owner,
    storedResolutionFields?.pathway,
    storedResolutionFields?.stage,
    storedResolutionFields?.targetDate,
    ticket?.id,
    ticket?.metadata?.resolutionPlan?.ownerNotes,
  ]);

  useEffect(() => {
    let cancelled = false;
    const paths = ticketAttachments.map((attachment) => attachment.path).filter(Boolean) as string[];
    if (paths.length === 0) {
      setAttachmentUrls({});
      return () => {
        cancelled = true;
      };
    }

    Promise.all(
      paths.map(async (path) => {
        const { data, error } = await backendSupabase.storage
          .from('ticket-attachments')
          .createSignedUrl(path, 60 * 60);
        return [path, error ? '' : data?.signedUrl || ''] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setAttachmentUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
    });

    return () => {
      cancelled = true;
    };
  }, [ticket?.id, ticketAttachments]);

  if (!ticket) return null;

  const effectiveTicket = ticketOverride ?? ticket;
  const currentEmployeeName = user?.email
    ? (ASSOCIATES.find(e => e.email && e.email.toLowerCase() === user.email!.toLowerCase())?.name ?? null)
    : null;
  const isOwner = Boolean(currentEmployeeName && effectiveTicket.assignedTo === currentEmployeeName);

  const handleQuickAction = async (action: 'claim' | 'await_member' | 'unblock') => {
    setActionLoading(action);
    setActionError(null);
    const { data, error } = await invokeTicketingFunction<{ ticket: typeof ticket; emailSent: boolean }>('ticket-resolve', {
      body: { ticketId: ticket.id, action },
    });
    if (error || !data?.ticket) {
      setActionError(error?.message || 'Action failed. Please try again.');
    } else {
      setTicketOverride(data.ticket as typeof ticket);
    }
    setActionLoading(null);
  };

  const priorityMeta = PRIORITY_SLA[ticket.priority];
  const currentValues = { ...ticket, ...editValues };
  const subCategories = CATEGORIES[currentValues.category || ticket.category] || ['Other'];
  const statusAllowed = canUpdateTicketStatus(ticket);
  const resolutionAllowed = canEditTicketResolution(ticket);
  const statusChanged = statusValues.status !== ticket.status;
  const statusValidationErrors = statusAllowed ? validateTicketStatusUpdate(ticket, statusValues) : [];
  const statusInputStarted = statusChanged ||
    Boolean(statusValues.reason.trim()) ||
    Boolean(statusValues.actionTaken.trim()) ||
    Boolean(statusValues.resolutionSummary?.trim()) ||
    Boolean(statusValues.outcome?.trim()) ||
    Boolean(statusValues.comments?.trim()) ||
    Boolean(statusValues.notes?.trim()) ||
    Boolean((statusValues.followUps || []).some((followUp) => followUp.date?.trim() || followUp.notes?.trim()));
  const statusReady = statusAllowed && statusValidationErrors.length === 0;
  const latestResolution = ticket.metadata?.latestResolution;
  const resolutionHistory = Array.isArray(ticket.metadata?.resolutionHistory)
    ? ticket.metadata.resolutionHistory
    : [];
  const followUpHistory = Array.isArray(ticket.metadata?.followUpHistory)
    ? ticket.metadata.followUpHistory
    : [];
  const resolutionChanged = resolutionStepsText !== resolutionStepsKey ||
    resolutionOwnerNotes !== (ticket.metadata?.resolutionPlan?.ownerNotes || '') ||
    resolutionStage !== (storedResolutionFields?.stage || '') ||
    resolutionPathway !== (storedResolutionFields?.pathway || '') ||
    resolutionOwner !== (storedResolutionFields?.owner || '') ||
    resolutionTargetDate !== (storedResolutionFields?.targetDate || '') ||
    resolutionFollowUpChannel !== (storedResolutionFields?.memberFollowUpChannel || '') ||
    resolutionMemberResponse !== (storedResolutionFields?.memberResponse || '') ||
    resolutionEscalation !== (storedResolutionFields?.escalationNeeded || '');
  const saveEdits = async () => {
    setSaving(true);
    setEditError('');
    try {
      await updateTicket(ticket.id, buildTicketEditPatch(ticket, editValues));
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to save ticket edits.');
    } finally {
      setSaving(false);
    }
  };

  const removeTicket = async () => {
    if (!window.confirm(`Delete ticket ${ticket.id}? This permanently removes the submitted ticket from the backend.`)) return;
    await deleteTicket(ticket.id);
    onClose();
  };

  const submitStatusUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!statusReady) {
      setStatusError(statusValidationErrors.join(' '));
      return;
    }
    setStatusSaving(true);
    setStatusError('');
    try {
      await updateTicketStatus(ticket.id, statusValues);
      setStatusValues(defaultStatusValues({ ...ticket, status: statusValues.status }));
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Unable to update ticket status.');
    } finally {
      setStatusSaving(false);
    }
  };

  const saveResolutionPlan = async () => {
    if (!resolutionAllowed) {
      setResolutionError('Only the ticket owner, escalation manager, or admin can edit the resolution plan.');
      return;
    }
    setResolutionSaving(true);
    setResolutionError('');
    try {
      await updateTicketResolutionPlan(ticket.id, {
        steps: stepsFromTextarea(resolutionStepsText),
        stage: resolutionStage,
        pathway: resolutionPathway,
        owner: resolutionOwner,
        targetDate: resolutionTargetDate,
        memberFollowUpChannel: resolutionFollowUpChannel,
        memberResponse: resolutionMemberResponse,
        escalationNeeded: resolutionEscalation,
        ownerNotes: resolutionOwnerNotes,
      });
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : 'Unable to save resolution plan.');
    } finally {
      setResolutionSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-white z-50 shadow-2xl flex flex-col border-l border-slate-200">
        <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 bg-white/92 backdrop-blur-xl border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-slate-400">{ticket.id}</span>
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded text-white ${priorityMeta.color}`}>
                {ticket.priority}
              </span>
            </div>
            {editing ? (
              <input
                value={currentValues.title || ''}
                onChange={(event) => setEditValues((values) => ({ ...values, title: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            ) : (
              <h3 className="font-bold text-stone-900 leading-snug pr-2">{ticket.title}</h3>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <>
                <button onClick={saveEdits} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-stone-950 px-2.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-40">
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Saving' : 'Save'}
                </button>
                <button onClick={() => { setEditing(false); setEditValues(ticket); }} className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-stone-600 transition hover:bg-slate-50">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-stone-600 transition hover:bg-slate-50">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button onClick={removeTicket} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-semibold text-red-700 transition hover:bg-red-100">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <form onSubmit={submitStatusUpdate} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status and resolution</label>
                <p className="mt-1 text-xs text-slate-500">
                  Status changes require reason and action taken. Follow-up-only saves need a complete date and note.
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                Current: {ticket.status}
              </span>
            </div>

            {!statusAllowed && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Only the assigned owner or an admin can change this ticket status.
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <EditSelect
                label="New status"
                value={statusValues.status}
                values={STATUSES.filter((status) => canSelectStatusFromTicket(ticket, status))}
                disabled={!statusAllowed}
                onChange={(status) => setStatusValues((values) => ({ ...values, status: status as Ticket['status'] }))}
              />
              <EditText
                label="Action date"
                value={statusValues.actionDate}
                type="date"
                disabled={!statusAllowed}
                onChange={(actionDate) => setStatusValues((values) => ({ ...values, actionDate }))}
              />
              <div className="md:col-span-2">
                <EditText
                  label="Reason for status change"
                  value={statusValues.reason}
                  disabled={!statusAllowed}
                  onChange={(reason) => setStatusValues((values) => ({ ...values, reason }))}
                />
              </div>
              <div className="md:col-span-2">
                <EditTextarea
                  label="Action taken"
                  value={statusValues.actionTaken}
                  rows={3}
                  disabled={!statusAllowed}
                  onChange={(actionTaken) => setStatusValues((values) => ({ ...values, actionTaken }))}
                />
              </div>
              {(statusValues.status === 'Resolved' || statusValues.status === 'Closed') && (
                <>
                  <div className="md:col-span-2">
                    <EditTextarea
                      label="Resolution summary"
                      value={statusValues.resolutionSummary || ''}
                      rows={3}
                      disabled={!statusAllowed}
                      onChange={(resolutionSummary) => setStatusValues((values) => ({ ...values, resolutionSummary }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <EditTextarea
                      label="Final outcome"
                      value={statusValues.outcome || ''}
                      rows={3}
                      disabled={!statusAllowed}
                      onChange={(outcome) => setStatusValues((values) => ({ ...values, outcome }))}
                    />
                  </div>
                </>
              )}
              <EditText
                label="Comments"
                value={statusValues.comments || ''}
                disabled={!statusAllowed}
                onChange={(comments) => setStatusValues((values) => ({ ...values, comments }))}
              />
              <div className="md:col-span-2">
                <EditTextarea
                  label="Internal notes"
                  value={statusValues.notes || ''}
                  rows={3}
                  disabled={!statusAllowed}
                  onChange={(notes) => setStatusValues((values) => ({ ...values, notes }))}
                />
              </div>
              <div className="md:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Follow-up dates and notes</label>
                  <button
                    type="button"
                    disabled={!statusAllowed}
                    onClick={() => setStatusValues((values) => ({
                      ...values,
                      followUps: [...(values.followUps || []), { date: '', notes: '' }],
                    }))}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add follow-up
                  </button>
                </div>
                {(statusValues.followUps || []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                    No follow-up dates added.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(statusValues.followUps || []).map((followUp, index) => (
                      <div key={index} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2 md:grid-cols-[150px_1fr_auto]">
                        <input
                          type="date"
                          value={followUp.date || ''}
                          disabled={!statusAllowed}
                          onChange={(event) => setStatusValues((values) => ({
                            ...values,
                            followUps: (values.followUps || []).map((item, itemIndex) => (
                              itemIndex === index ? { ...item, date: event.target.value } : item
                            )),
                          }))}
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100 disabled:text-slate-500"
                        />
                        <textarea
                          value={followUp.notes || ''}
                          rows={2}
                          disabled={!statusAllowed}
                          placeholder="Follow-up note"
                          onChange={(event) => setStatusValues((values) => ({
                            ...values,
                            followUps: (values.followUps || []).map((item, itemIndex) => (
                              itemIndex === index ? { ...item, notes: event.target.value } : item
                            )),
                          }))}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100 disabled:text-slate-500"
                        />
                        <button
                          type="button"
                          disabled={!statusAllowed}
                          onClick={() => setStatusValues((values) => ({
                            ...values,
                            followUps: (values.followUps || []).filter((_, itemIndex) => itemIndex !== index),
                          }))}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Remove follow-up"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {latestResolution && (
              <div className="mt-3 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-slate-600">
                <div className="font-semibold text-slate-800">Latest resolution note</div>
                <div className="mt-1">Reason: {latestResolution.reason}</div>
                <div className="mt-0.5">Action: {latestResolution.actionTaken}</div>
                {latestResolution.resolutionSummary && <div className="mt-0.5">Resolution: {latestResolution.resolutionSummary}</div>}
                {latestResolution.outcome && <div className="mt-0.5">Outcome: {latestResolution.outcome}</div>}
                {latestResolution.closedAt && <div className="mt-0.5">Closed: {new Date(latestResolution.closedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
              </div>
            )}

            {followUpHistory.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                <div className="font-semibold text-slate-800">Saved follow-ups</div>
                <div className="mt-2 space-y-1.5">
                  {followUpHistory.slice(0, 8).map((followUp, index) => (
                    <div key={`${followUp.date}-${followUp.createdAt}-${index}`} className="grid gap-1 border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0 md:grid-cols-[110px_1fr]">
                      <span className="font-semibold text-slate-700">{followUp.date}</span>
                      <span>{followUp.notes}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {resolutionHistory.length > 1 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                <div className="font-semibold text-slate-800">Resolution history</div>
                <div className="mt-2 space-y-2">
                  {resolutionHistory.slice(1, 6).map((entry, index) => (
                    <div key={`${entry.createdAt}-${index}`} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                      <div className="font-semibold text-slate-700">{entry.previousStatus} → {entry.status}</div>
                      <div className="mt-0.5">{entry.actionTaken}</div>
                      {entry.resolutionSummary && <div className="mt-0.5 text-slate-500">{entry.resolutionSummary}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {statusError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {statusError}
              </div>
            )}

            {!statusError && statusInputStarted && statusValidationErrors.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                {statusValidationErrors.join(' ')}
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={!statusReady || statusSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" />
                {statusSaving ? 'Saving...' : 'Save ticket update'}
              </button>
            </div>
          </form>

          {resolutionAssistant && (
            <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-blue-700">{resolutionAssistant.title}</div>
                  <p className="mt-1 text-xs text-slate-500">{resolutionAssistant.priorityReason}</p>
                </div>
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                  {resolutionAssistant.slaState}
                </span>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
                {resolutionAssistant.suggestedMemberReply}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Next actions</div>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {resolutionAssistant.nextActions.map((action) => (
                      <li key={action} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">{action}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Closure checklist</div>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {resolutionAssistant.closureChecklist.map((item) => (
                      <li key={item} className="flex gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">Resolution plan</div>
                <p className="mt-1 text-xs text-slate-500">
                  Structured owner plan, member response path, and next actions. Editable by {ticket.assignedTo} and escalation manager {getEscalationTarget(ticket.assignedTo)}.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{resolutionStage || 'Not started'}</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">{resolutionPathway || 'Member communication'}</span>
                {ticket.metadata?.resolutionPlan?.updatedAt && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    Updated {new Date(ticket.metadata.resolutionPlan.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                )}
              </div>
            </div>

            {!resolutionAllowed && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Only the ticket owner or escalation manager can edit this resolution plan.
              </div>
            )}

            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <EditSelect
                  label="Resolution stage"
                  value={resolutionStage}
                  values={selectValues(RESOLUTION_STAGES, resolutionStage)}
                  disabled={!resolutionAllowed}
                  onChange={setResolutionStage}
                />
                <EditSelect
                  label="Resolution pathway"
                  value={resolutionPathway}
                  values={selectValues(RESOLUTION_PATHWAYS, resolutionPathway)}
                  disabled={!resolutionAllowed}
                  onChange={setResolutionPathway}
                />
                <EditSelect
                  label="Resolution owner"
                  value={resolutionOwner}
                  values={selectValues(ASSOCIATES.map((associate) => associate.name), resolutionOwner)}
                  disabled={!resolutionAllowed}
                  onChange={setResolutionOwner}
                />
                <EditText
                  label="Target resolution date"
                  value={resolutionTargetDate}
                  type="date"
                  disabled={!resolutionAllowed}
                  onChange={setResolutionTargetDate}
                />
                <EditSelect
                  label="Member follow-up channel"
                  value={resolutionFollowUpChannel}
                  values={selectValues(RESOLUTION_FOLLOW_UP_CHANNELS, resolutionFollowUpChannel)}
                  disabled={!resolutionAllowed}
                  onChange={setResolutionFollowUpChannel}
                />
                <EditSelect
                  label="Member response"
                  value={resolutionMemberResponse}
                  values={selectValues(RESOLUTION_MEMBER_RESPONSES, resolutionMemberResponse)}
                  disabled={!resolutionAllowed}
                  onChange={setResolutionMemberResponse}
                />
                <div className="md:col-span-2">
                  <EditSelect
                    label="Escalation requirement"
                    value={resolutionEscalation}
                    values={selectValues(RESOLUTION_ESCALATION_OPTIONS, resolutionEscalation)}
                    disabled={!resolutionAllowed}
                    onChange={setResolutionEscalation}
                  />
                </div>
              </div>
              <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Recommended steps
                <textarea
                  value={resolutionStepsText}
                  rows={7}
                  disabled={!resolutionAllowed}
                  onChange={(event) => setResolutionStepsText(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium normal-case tracking-normal text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </label>
              <EditTextarea
                label="Owner / manager notes"
                value={resolutionOwnerNotes}
                rows={3}
                disabled={!resolutionAllowed}
                onChange={setResolutionOwnerNotes}
              />
            </div>

            {resolutionError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {resolutionError}
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={saveResolutionPlan}
                disabled={!resolutionAllowed || !resolutionChanged || resolutionSaving}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-stone-950 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" />
                {resolutionSaving ? 'Saving...' : 'Save resolution plan'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 block">Assigned To</label>
            <select
              value={editing ? currentValues.assignedTo : ticket.assignedTo}
              onChange={(e) => {
                const found = ASSOCIATES.find((a) => a.name === e.target.value);
                if (editing) setEditValues((values) => ({ ...values, assignedTo: e.target.value, team: found?.team || ticket.team }));
                else {
                  setEditError('');
                  updateTicket(ticket.id, { assignedTo: e.target.value, team: found?.team || ticket.team })
                    .catch((error) => setEditError(error instanceof Error ? error.message : 'Unable to update assignment.'));
                }
              }}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
            >
              {ASSOCIATES.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
          </div>

          {editError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {editError}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 block">Description</label>
            {editing ? (
              <textarea
                value={currentValues.description || ''}
                onChange={(event) => setEditValues((values) => ({ ...values, description: event.target.value }))}
                rows={10}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-relaxed text-stone-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            ) : (
              <FormattedTicketText text={ticket.description} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {editing ? (
              <>
                <EditSelect label="Category" value={currentValues.category || ''} values={Object.keys(CATEGORIES)} onChange={(value) => setEditValues((state) => ({ ...state, category: value, subCategory: CATEGORIES[value]?.[0] || 'Other' }))} />
                <EditSelect label="Sub-category" value={currentValues.subCategory || ''} values={subCategories} onChange={(value) => setEditValues((state) => ({ ...state, subCategory: value }))} />
                <EditSelect label="Studio" value={currentValues.studio || ''} values={STUDIOS} onChange={(value) => setEditValues((state) => ({ ...state, studio: value }))} />
                <EditSelect label="Priority" value={currentValues.priority || ''} values={['Critical', 'High', 'Medium', 'Low']} onChange={(value) => setEditValues((state) => ({ ...state, priority: value as Ticket['priority'] }))} />
                <EditSelect label="Instructor" value={currentValues.trainer || ''} values={['', ...TRAINERS]} onChange={(value) => setEditValues((state) => ({ ...state, trainer: value || undefined }))} />
                <MomenceSessionTicketField
                  classType={currentValues.classType}
                  classDateTime={currentValues.classDateTime}
                  trainer={currentValues.trainer}
                  studio={currentValues.studio}
                  onSelect={(session) => {
                    setEditValues((state) => ({
                      ...state,
                      classType: session.classType || session.label,
                      classDateTime: session.startsAt || undefined,
                      trainer: session.trainer || state.trainer,
                      studio: session.studio || state.studio,
                    }));
                  }}
                  onClear={() => {
                    setEditValues((state) => ({
                      ...state,
                      classType: undefined,
                      classDateTime: undefined,
                    }));
                  }}
                />
                <MomenceMemberTicketField
                  memberName={currentValues.memberName}
                  memberContact={currentValues.memberContact}
                  onSelect={(member) => {
                    setEditValues((state) => ({
                      ...state,
                      memberName: member.name || member.label,
                      memberContact: member.email || member.phoneNumber || member.description || undefined,
                    }));
                  }}
                  onClear={() => {
                    setEditValues((state) => ({
                      ...state,
                      memberName: undefined,
                      memberContact: undefined,
                    }));
                  }}
                />
                <EditText label="Reported By" value={currentValues.reportedBy || ''} onChange={(value) => setEditValues((state) => ({ ...state, reportedBy: value || undefined }))} />
                <EditSelect label="Sentiment" value={currentValues.sentiment || ''} values={['', 'Positive', 'Neutral', 'Negative', 'Angry']} onChange={(value) => setEditValues((state) => ({ ...state, sentiment: value ? value as Ticket['sentiment'] : undefined }))} />
                <EditText label="Tags" value={(currentValues.tags || []).join(', ')} onChange={(value) => setEditValues((state) => ({ ...state, tags: tagsFromInput(value) }))} />
              </>
            ) : (
              <>
                <Field icon={<Tag className="w-3.5 h-3.5" />} label="Category" value={ticket.category} />
                <Field icon={<Tag className="w-3.5 h-3.5" />} label="Sub-category" value={ticket.subCategory} />
                <Field icon={<MapPin className="w-3.5 h-3.5" />} label="Studio" value={ticket.studio} />
              </>
            )}
            <Field icon={<Clock className="w-3.5 h-3.5" />} label="SLA Due" value={new Date(ticket.slaDueAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />
            <Field icon={<User className="w-3.5 h-3.5" />} label="Owner" value={ticket.assignedTo} />
            <Field icon={<User className="w-3.5 h-3.5" />} label="Next Escalation" value={getEscalationTarget(ticket.assignedTo)} />
            {ticket.reportedBy && <Field icon={<MessageSquare className="w-3.5 h-3.5" />} label="Reported By" value={ticket.reportedBy} />}
            {ticket.sentiment && <Field icon={<MessageSquare className="w-3.5 h-3.5" />} label="Sentiment" value={ticket.sentiment} />}
          </div>

          {!editing && (ticket.memberName || ticket.memberContact || ticket.classType || ticket.classDateTime || ticket.trainer) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Lock className="w-3.5 h-3.5" />
                  Locked creation context
                </div>
                <button
                  type="button"
                  onClick={() => setEditingLinkedContext((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <Pencil className="w-3 h-3" />
                  {editingLinkedContext ? 'Hide edit' : 'Edit linked context'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {ticket.memberName && <Field icon={<User className="w-3.5 h-3.5" />} label="Member" value={ticket.memberName} />}
                {ticket.memberContact && <Field icon={<Phone className="w-3.5 h-3.5" />} label="Contact" value={ticket.memberContact} />}
                {ticket.classType && <Field icon={<Calendar className="w-3.5 h-3.5" />} label="Session" value={ticket.classType} />}
                {ticket.classDateTime && <Field icon={<Clock className="w-3.5 h-3.5" />} label="Session Time" value={new Date(ticket.classDateTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />}
                {ticket.trainer && <Field icon={<User className="w-3.5 h-3.5" />} label="Instructor" value={ticket.trainer} />}
              </div>
            </div>
          )}

          {editingLinkedContext && <MomenceAutomationPanel ticket={ticket} />}

          {ticketAttachments.length > 0 && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 block">Attachments</label>
              <div className="space-y-2">
                {ticketAttachments.map((attachment, index) => (
                  <a
                    key={`${attachment.path || attachment.publicUrl || attachment.fileName || 'attachment'}-${index}`}
                    href={(attachment.path && attachmentUrls[attachment.path]) || attachment.publicUrl || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-blue-700" />
                      <span className="truncate">{attachment.fileName || `Attachment ${index + 1}`}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : 'File'}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {ticket.tags.length > 0 && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 block">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {ticket.tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 rounded-md">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
            Created {new Date(ticket.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        </div>
        </div>{/* end flex-1 overflow-y-auto */}

        {/* Owner action bar */}
        {(isOwner || (effectiveTicket.status === 'New' && (!effectiveTicket.assignedTo || effectiveTicket.assignedTo === currentEmployeeName))) && effectiveTicket.status !== 'Resolved' && effectiveTicket.status !== 'Closed' && (
          <div className="bg-white dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 flex flex-col gap-2 shrink-0">
            <div className="flex gap-2">
              {effectiveTicket.status === 'New' && (!effectiveTicket.assignedTo || effectiveTicket.assignedTo === currentEmployeeName) && (
                <button
                  onClick={() => handleQuickAction('claim')}
                  disabled={actionLoading === 'claim'}
                  className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
                >
                  {actionLoading === 'claim' ? 'Claiming…' : 'Claim Ticket'}
                </button>
              )}
              {isOwner && effectiveTicket.status === 'In Progress' && (
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
              {isOwner && effectiveTicket.status === 'Awaiting Member' && (
                <button
                  onClick={() => handleQuickAction('unblock')}
                  disabled={!!actionLoading}
                  className="flex-1 rounded-lg border border-blue-300 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 text-sm font-medium py-2 transition-colors"
                >
                  {actionLoading === 'unblock' ? 'Updating…' : 'Member Responded — Unblock'}
                </button>
              )}
            </div>
            {actionError && (
              <p className="text-xs text-red-600 dark:text-red-400">{actionError}</p>
            )}
          </div>
        )}

        {/* Resolution drawer */}
        <ResolveTicketDrawer
          ticket={effectiveTicket}
          open={resolveDrawerOpen}
          onClose={() => setResolveDrawerOpen(false)}
          onResolved={(updatedTicket) => {
            setTicketOverride(updatedTicket as typeof ticket);
            setResolveDrawerOpen(false);
          }}
        />
      </div>
    </>
  );
};

const Field: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div>
    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
      {icon}
      {label}
    </div>
    <div className="text-sm text-slate-900 dark:text-slate-100">{value}</div>
  </div>
);

const EditText: React.FC<{ label: string; value: string; type?: string; disabled?: boolean; onChange: (value: string) => void }> = ({ label, value, type = 'text', disabled, onChange }) => (
  <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
    {label}
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium normal-case tracking-normal text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100 disabled:text-slate-500"
    />
  </label>
);

const EditTextarea: React.FC<{ label: string; value: string; rows?: number; disabled?: boolean; onChange: (value: string) => void }> = ({ label, value, rows = 3, disabled, onChange }) => (
  <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
    {label}
    <textarea
      value={value}
      rows={rows}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-medium normal-case tracking-normal text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100 disabled:text-slate-500"
    />
  </label>
);

const EditSelect: React.FC<{ label: string; value: string; values: string[] | readonly string[]; disabled?: boolean; onChange: (value: string) => void }> = ({ label, value, values, disabled, onChange }) => (
  <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
    {label}
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium normal-case tracking-normal text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100 disabled:text-slate-500"
    >
      {values.map((item) => (
        <option key={item} value={item}>{item || 'None'}</option>
      ))}
    </select>
  </label>
);

const FormattedTicketText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let bullets: string[] = [];
  const headingLabels = new Set([
    'Instructor Evaluation Brief',
    'Evaluation Snapshot',
    'Weighted Scorecard',
    'Demonstrated Strengths',
    'Coaching Attention Areas',
    'Evaluator / Training Notes',
    'Coaching Plan And Follow-up',
    'Routing Context',
  ]);

  const flushBullets = () => {
    if (bullets.length === 0) return;
    elements.push(
      <ul key={`ul-${elements.length}`} className="my-2 list-disc space-y-1 pl-5">
        {bullets.map((line, index) => (
          <li key={index}>{line.replace(/^[-*]\s+/, '').trim()}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      elements.push(<div key={`space-${index}`} className="h-2" />);
      return;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line);
      return;
    }
    flushBullets();
    if (headingLabels.has(line)) {
      const isTitle = line === 'Instructor Evaluation Brief';
      elements.push(
        <div
          key={`heading-${index}`}
          className={isTitle ? 'mb-3 text-sm font-bold uppercase tracking-wider text-slate-900' : 'mb-1 mt-3 text-xs font-bold uppercase tracking-wider text-blue-700'}
        >
          {line}
        </div>
      );
      return;
    }
    elements.push(<p key={`p-${index}`} className="mb-2">{line}</p>);
  });
  flushBullets();

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-relaxed text-stone-700 shadow-inner shadow-stone-200/50">
      {elements}
    </div>
  );
};
