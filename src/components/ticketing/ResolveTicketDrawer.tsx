import React, { useState, useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { RESOLUTION_TYPES, ResolveTicketPayload, ResolveTicketResponse } from '@/lib/ticket-resolution';
import { invokeTicketingFunction } from '@/lib/ticketing-functions';
import { useBackendAuth } from '@/contexts/useBackendAuth';
import type { Ticket } from '@/lib/ticketing-data';

interface Props {
  ticket: Ticket;
  open: boolean;
  onClose: () => void;
  onResolved: (updatedTicket: unknown) => void;
}

export function ResolveTicketDrawer({ ticket, open, onClose, onResolved }: Props) {
  const { user } = useBackendAuth();
  const [resolutionType, setResolutionType] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [reporterContacted, setReporterContacted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailWarning, setEmailWarning] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (open) {
      setResolutionType('');
      setResolutionNote('');
      setReporterContacted(false);
      setError('');
      setEmailWarning(false);
      setSuccessMessage('');
    }
  }, [open, ticket.id]);

  if (!open) return null;

  const isAssignee = ticket.assignedTo === user?.id;
  const noteLength = resolutionNote.trim().length;
  const canSubmit = isAssignee && resolutionType !== '' && noteLength >= 20 && reporterContacted && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    setEmailWarning(false);
    setSuccessMessage('');

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
      if (!data.emailSent) {
        // Stay open to show the email warning banner; caller still gets the update
        onResolved(data.ticket);
        setSuccessMessage('Ticket resolved, but the reporter email failed to send — please notify them manually.');
      } else {
        setSuccessMessage('Ticket successfully resolved.');
        onResolved(data.ticket);
        onClose();
      }
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

          {/* Not-assignee warning */}
          {!isAssignee && (
            <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              Only the assigned owner can resolve this ticket.
            </p>
          )}

          {/* Resolution type */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Resolution type <span className="text-red-500">*</span>
            </label>
            <select
              value={resolutionType}
              onChange={(e) => setResolutionType(e.target.value)}
              disabled={!isAssignee}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
              disabled={!isAssignee}
              placeholder="Describe what was done to resolve this issue (min 20 characters)…"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
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
              disabled={!isAssignee}
              className="mt-0.5 rounded border-zinc-300 text-emerald-500 focus:ring-emerald-500 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              I have contacted or notified the reporter about this resolution
            </span>
          </label>

          {/* Network / API error */}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              <p>{error}</p>
              <button
                type="button"
                onClick={handleSubmit}
                className="mt-2 text-xs font-medium underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Email warning */}
          {emailWarning && !error && (
            <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              {successMessage}
            </p>
          )}

          {/* Success */}
          {successMessage && !emailWarning && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
              {successMessage}
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
