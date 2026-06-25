import React, { useState } from 'react';
import { CATEGORIES, PRIORITY_SLA, STUDIOS, Ticket } from '@/lib/ticketing-data';
import { Sparkles, Check, Pencil, MapPin, User, Calendar, Tag, Clock, ShieldCheck, AlertTriangle, Brain, Route, Layers3, Loader2, MessageSquareText, ChevronRight, Zap, Target, ArrowRight } from 'lucide-react';
import { SlaCountdown } from './SlaCountdown';
import { TicketReviewInsights } from '@/lib/ticket-review';
import { MomenceMemberTicketField, MomenceSessionTicketField } from './MomenceTicketEntityFields';
import { buildRecommendedResolutionSteps, buildSmartTicketIntelligence, DuplicatePatternInsights, SmartTicketIntelligence } from '@/lib/smart-ops-intelligence';

interface DraftTicket {
  title: string;
  description: string;
  category: string;
  subCategory: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  studio: string;
  trainer?: string | null;
  classType?: string | null;
  classDateTime?: string | null;
  memberName?: string | null;
  memberContact?: string | null;
  reportedBy?: string | null;
  assignedTo?: string | null;
  department?: string | null;
  tags: string[];
  sentiment?: string;
  conversationSummary?: string;
  metadata?: Record<string, unknown>;
}

interface Props {
  draft: DraftTicket;
  onConfirm: () => void;
  onEdit: () => void;
  onDiscard?: () => void;
  onSaveEdit?: (draft: DraftTicket) => void;
  confirmed?: boolean;
  ticketId?: string;
  confirmedTicket?: Pick<Ticket, 'slaDueAt' | 'status'>;
  publishing?: boolean;
  reviewInsights?: TicketReviewInsights;
  duplicatePatternInsights?: DuplicatePatternInsights;
  momenceLoading?: boolean;
  momenceError?: string | null;
}

const PRIORITY_VISUAL = {
  Critical: {
    bar: 'bg-gradient-to-r from-red-500 via-rose-500 to-red-600',
    badge: 'bg-red-500/10 text-red-600 ring-1 ring-red-200',
    dot: 'bg-red-500',
    glow: 'shadow-[0_0_0_3px_rgba(239,68,68,0.12)]',
    accent: 'border-red-100 bg-red-50/60',
    text: 'text-red-600',
  },
  High: {
    bar: 'bg-gradient-to-r from-orange-400 via-amber-400 to-orange-500',
    badge: 'bg-orange-500/10 text-orange-600 ring-1 ring-orange-200',
    dot: 'bg-orange-400',
    glow: 'shadow-[0_0_0_3px_rgba(249,115,22,0.12)]',
    accent: 'border-orange-100 bg-orange-50/60',
    text: 'text-orange-600',
  },
  Medium: {
    bar: 'bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-600',
    badge: 'bg-blue-500/10 text-blue-600 ring-1 ring-blue-200',
    dot: 'bg-blue-500',
    glow: 'shadow-[0_0_0_3px_rgba(59,130,246,0.10)]',
    accent: 'border-blue-100 bg-blue-50/60',
    text: 'text-blue-600',
  },
  Low: {
    bar: 'bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-200',
    dot: 'bg-emerald-400',
    glow: 'shadow-[0_0_0_3px_rgba(16,185,129,0.10)]',
    accent: 'border-emerald-100 bg-emerald-50/60',
    text: 'text-emerald-600',
  },
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function stepsFromText(value: string): string[] {
  return Array.from(new Set(
    value
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
  ));
}

function getDraftResolutionSteps(draft: DraftTicket): string[] {
  const metadataSteps = stringArray(draft.metadata?.recommendedResolutionSteps);
  if (metadataSteps.length) return metadataSteps;
  return buildRecommendedResolutionSteps({
    title: draft.title,
    description: draft.description,
    category: draft.category,
    subCategory: draft.subCategory,
    priority: draft.priority,
    studio: draft.studio,
    assignedTo: draft.assignedTo || undefined,
    memberName: draft.memberName || undefined,
    memberContact: draft.memberContact || undefined,
    classType: draft.classType || undefined,
    classDateTime: draft.classDateTime || undefined,
    sentiment: draft.sentiment as Ticket['sentiment'] | undefined,
  });
}

export const TicketPreviewCard: React.FC<Props> = ({ draft, onConfirm, onEdit, onDiscard, onSaveEdit, confirmed, ticketId, confirmedTicket, publishing = false, reviewInsights, duplicatePatternInsights, momenceLoading = false, momenceError }) => {
  const pv = PRIORITY_VISUAL[draft.priority] || PRIORITY_VISUAL.Medium;
  const slaHours = PRIORITY_SLA[draft.priority]?.hours ?? PRIORITY_SLA.Medium.hours;
  const tags = Array.isArray(draft.tags) ? draft.tags : [];
  const [editing, setEditing] = useState(false);
  const [editedDraft, setEditedDraft] = useState<DraftTicket>(draft);

  React.useEffect(() => {
    setEditedDraft(draft);
  }, [draft]);

  const updateEditedDraft = (field: keyof DraftTicket, value: string) => {
    setEditedDraft((current) => ({ ...current, [field]: value }));
  };
  const recommendedResolutionSteps = getDraftResolutionSteps(editing ? editedDraft : draft);
  const updateRecommendedResolutionSteps = (value: string) => {
    setEditedDraft((current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        recommendedResolutionSteps: stepsFromText(value),
      },
    }));
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_20px_60px_rgba(15,23,42,0.10)] backdrop-blur-sm">

      {/* Priority accent bar */}
      <div className={`h-[3px] w-full ${pv.bar}`} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex h-6 w-6 items-center justify-center">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-30 ${pv.dot}`} />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${pv.dot}`} />
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-slate-400" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Athena draft</span>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${pv.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${pv.dot}`} />
          {draft.priority}
        </span>
      </div>

      <div className="p-4">

        {/* Title + classification */}
        <div className="mb-4">
          {editing ? (
            <input
              value={editedDraft.title}
              onChange={(event) => updateEditedDraft('title', event.target.value)}
              className="mb-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          ) : (
            <h4 className="mb-2 text-[15px] font-bold leading-snug tracking-tight text-slate-950">{draft.title}</h4>
          )}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{draft.category}</span>
            <ChevronRight className="h-3 w-3 text-slate-300" />
            <span className={`rounded-md px-2 py-0.5 font-semibold ${pv.badge}`}>{draft.subCategory}</span>
            {draft.sentiment && (
              <>
                <ChevronRight className="h-3 w-3 text-slate-300" />
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-500">{draft.sentiment}</span>
              </>
            )}
          </div>
        </div>

        {/* Description / edit body */}
        {editing ? (
          <div className="mb-4 space-y-2.5">
            <textarea
              value={editedDraft.description}
              onChange={(event) => updateEditedDraft('description', event.target.value)}
              rows={7}
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
            <textarea
              value={recommendedResolutionSteps.join('\n')}
              onChange={(event) => updateRecommendedResolutionSteps(event.target.value)}
              rows={5}
              placeholder="Resolution steps (one per line)"
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
              aria-label="Recommended resolution steps"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <EditSelect label="Priority" value={editedDraft.priority} options={Object.keys(PRIORITY_SLA)} onChange={(value) => updateEditedDraft('priority', value as DraftTicket['priority'])} />
              <EditSelect
                label="Category"
                value={editedDraft.category}
                options={Object.keys(CATEGORIES)}
                onChange={(value) => {
                  setEditedDraft((current) => ({
                    ...current,
                    category: value,
                    subCategory: CATEGORIES[value]?.includes(current.subCategory) ? current.subCategory : CATEGORIES[value]?.[0] || 'Other',
                  }));
                }}
              />
              <EditSelect label="Subcategory" value={editedDraft.subCategory} options={CATEGORIES[editedDraft.category] || []} onChange={(value) => updateEditedDraft('subCategory', value)} />
              <EditSelect label="Studio" value={editedDraft.studio} options={STUDIOS} onChange={(value) => updateEditedDraft('studio', value)} />
              <EditInput label="Instructor" value={editedDraft.trainer || ''} onChange={(value) => updateEditedDraft('trainer', value)} />
              <MomenceSessionTicketField
                classType={editedDraft.classType}
                classDateTime={editedDraft.classDateTime}
                trainer={editedDraft.trainer}
                studio={editedDraft.studio}
                onSelect={(session) => {
                  setEditedDraft((current) => ({
                    ...current,
                    classType: session.classType || session.label,
                    classDateTime: session.startsAt || null,
                    trainer: session.trainer || current.trainer,
                    studio: session.studio || current.studio,
                  }));
                }}
                onClear={() => {
                  setEditedDraft((current) => ({
                    ...current,
                    classType: null,
                    classDateTime: null,
                  }));
                }}
              />
              <MomenceMemberTicketField
                memberName={editedDraft.memberName}
                memberContact={editedDraft.memberContact}
                onSelect={(member) => {
                  setEditedDraft((current) => ({
                    ...current,
                    memberName: member.name || member.label,
                    memberContact: member.email || member.phoneNumber || member.description || null,
                  }));
                }}
                onClear={() => {
                  setEditedDraft((current) => ({
                    ...current,
                    memberName: null,
                    memberContact: null,
                  }));
                }}
              />
              <EditInput label="Documented by" value={editedDraft.reportedBy || ''} onChange={(value) => updateEditedDraft('reportedBy', value)} />
              <EditInput label="Owner" value={editedDraft.assignedTo || ''} onChange={(value) => updateEditedDraft('assignedTo', value)} />
              <EditInput label="Department" value={editedDraft.department || ''} onChange={(value) => updateEditedDraft('department', value)} />
            </div>
          </div>
        ) : (
          <>
            {/* Description */}
            <FormattedDescription text={draft.description} />

            {/* Resolution steps — timeline style */}
            {recommendedResolutionSteps.length > 0 && (
              <div className={`mb-4 rounded-xl border p-3.5 ${pv.accent}`}>
                <div className={`mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${pv.text}`}>
                  <Target className="h-3.5 w-3.5" />
                  Resolution playbook
                </div>
                <ol className="space-y-0">
                  {recommendedResolutionSteps.map((step, index) => (
                    <li key={`${step}-${index}`} className="relative flex gap-3">
                      {/* Timeline line */}
                      {index < recommendedResolutionSteps.length - 1 && (
                        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-200/70" />
                      )}
                      <div className={`relative z-10 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${pv.dot}`}>
                        {index + 1}
                      </div>
                      <p className="pb-3 pt-0.5 text-[11.5px] leading-relaxed text-slate-700">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}

        {/* Metadata grid */}
        <div className="mb-3 space-y-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50">
          <MetaRow icon={<Tag className="h-3 w-3" />} label="Category" value={`${draft.category} / ${draft.subCategory}`} />
          {draft.studio && <MetaRow icon={<MapPin className="h-3 w-3" />} label="Studio" value={draft.studio} />}
          {draft.memberName && <MetaRow icon={<User className="h-3 w-3" />} label="Member" value={draft.memberName} highlight />}
          {draft.memberContact && <MetaRow icon={<User className="h-3 w-3" />} label="Contact" value={draft.memberContact} />}
          {draft.trainer && <MetaRow icon={<User className="h-3 w-3" />} label="Instructor" value={draft.trainer} />}
          {draft.classType && <MetaRow icon={<Calendar className="h-3 w-3" />} label="Session" value={draft.classType} />}
          {draft.classDateTime && <MetaRow icon={<Clock className="h-3 w-3" />} label="Session time" value={new Date(draft.classDateTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />}
          <MetaRow icon={<ShieldCheck className="h-3 w-3" />} label="Documented by" value={draft.reportedBy || 'Auto-assigned'} />
          <MetaRow icon={<User className="h-3 w-3" />} label="Owner" value={draft.assignedTo || 'Auto-routed'} />
          <MetaRow icon={<Clock className="h-3 w-3" />} label="SLA target" value={`${slaHours}h from publish`} last />
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Review insights */}
        {!confirmed && reviewInsights && !editing && (
          <TicketReviewPanel insights={reviewInsights} duplicatePatternInsights={duplicatePatternInsights} momenceLoading={momenceLoading} momenceError={momenceError} draft={draft} />
        )}

        {/* Confirmed state */}
        {confirmed ? (
          <div className="overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
            <div className="flex items-center gap-3 border-b border-emerald-100 px-4 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.30)]">
                <Check className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">Published</div>
                <div className="truncate text-xs font-semibold text-slate-800">{ticketId} · Live in dashboard</div>
              </div>
            </div>
            <div className="px-4 py-3">
              {confirmedTicket ? (
                <SlaCountdown slaDueAt={confirmedTicket.slaDueAt} status={confirmedTicket.status} compact className="w-full justify-start ring-0" />
              ) : (
                <span className="text-[11px] font-medium text-emerald-600">SLA clock syncing...</span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {editing ? (
              <div className="flex gap-2">
                <button
                  onClick={() => { onSaveEdit?.(editedDraft); setEditing(false); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-950 py-2.5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.20)] transition hover:-translate-y-0.5 hover:bg-slate-800 active:translate-y-0"
                >
                  <Check className="h-3.5 w-3.5" /> Save draft
                </button>
                <button
                  onClick={() => { setEditedDraft(draft); setEditing(false); }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {/* Publish — primary CTA */}
                <button
                  onClick={onConfirm}
                  disabled={publishing}
                  className={`relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.22)] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.28)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${pv.bar}`}
                >
                  <span className="absolute inset-0 bg-black/0 hover:bg-black/5 transition" />
                  {publishing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</>
                  ) : (
                    <><Check className="h-4 w-4" /> Publish ticket</>
                  )}
                </button>

                {/* Secondary actions */}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { onEdit(); setEditing(true); }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[11px] font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button
                    onClick={() => { onEdit(); setEditing(true); }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[11px] font-semibold text-slate-600 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                  >
                    <Route className="h-3 w-3" /> Reroute
                  </button>
                  <button
                    onClick={onDiscard}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[11px] font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    Discard
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const cleanInlineMarkdown = (value: string) =>
  value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[-*]\s+/, '')
    .trim();

const FormattedDescription: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    elements.push(
      <ul key={`ul-${elements.length}`} className="my-2 space-y-1 pl-3">
        {bullets.map((line, index) => (
          <li key={index} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>{cleanInlineMarkdown(line)}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || /^(\*{3,}|-{3,})$/.test(line)) {
      flushBullets();
      elements.push(<div key={`space-${index}`} className="h-1.5" />);
      return;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line);
      return;
    }
    flushBullets();
    elements.push(<p key={`p-${index}`} className="mb-1 leading-relaxed">{cleanInlineMarkdown(line)}</p>);
  });
  flushBullets();

  return (
    <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3 text-[12.5px] leading-relaxed text-slate-700">
      {elements}
    </div>
  );
};

const MetaRow: React.FC<{ icon: React.ReactNode; label: string; value: string; highlight?: boolean; last?: boolean }> = ({ icon, label, value, highlight, last }) => (
  <div className={`flex items-center gap-3 px-3 py-2.5 ${!last ? 'border-b border-slate-100' : ''} ${highlight ? 'bg-blue-50/60' : ''}`}>
    <span className={`shrink-0 ${highlight ? 'text-blue-500' : 'text-slate-400'}`}>{icon}</span>
    <span className="w-[80px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</span>
    <span className={`min-w-0 truncate text-[11.5px] font-medium ${highlight ? 'text-blue-700' : 'text-slate-700'}`} title={value}>{value}</span>
  </div>
);

const TicketReviewPanel: React.FC<{
  insights: TicketReviewInsights;
  duplicatePatternInsights?: DuplicatePatternInsights;
  momenceLoading: boolean;
  momenceError?: string | null;
  draft: DraftTicket;
}> = ({ insights, duplicatePatternInsights, momenceLoading, momenceError, draft }) => {
  const smart = buildSmartTicketIntelligence({ draft: draft as BuildableDraftTicket });
  const averageConfidence = Math.round(
    insights.confidence.reduce((sum, item) => sum + item.score, 0) / Math.max(1, insights.confidence.length)
  );

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">

      {/* Duplicate warning */}
      {insights.duplicateWarning && (
        <div className="border-b border-amber-100 bg-amber-50 px-3.5 py-3 text-[11.5px] text-amber-900">
          <div className="mb-1 flex items-center gap-2 font-bold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Exact duplicate: {insights.duplicateWarning.ticketId}
          </div>
          <div className="leading-relaxed opacity-80">
            {insights.duplicateWarning.title} · {insights.duplicateWarning.status}
          </div>
        </div>
      )}

      {duplicatePatternInsights && <PatternNotice insights={duplicatePatternInsights} />}

      {/* Decision strip */}
      <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-3.5 py-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Pre-publish review</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${confidenceBadge(averageConfidence)}`}>
            {averageConfidence}% ready
          </span>
        </div>
        <SmartOpsReviewStrip intelligence={smart} momenceLoading={momenceLoading} momenceReady={insights.momenceChips.length > 0} confidenceScore={averageConfidence} />
      </div>

      <div className="grid gap-3 p-3.5 xl:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.6fr)]">
        <div className="grid gap-2">
          <ReviewBlock icon={<Route className="h-3.5 w-3.5" />} title="Routing evidence">
            <StructuredLineList lines={insights.routingRationale} />
          </ReviewBlock>
          <ReviewBlock icon={<Brain className="h-3.5 w-3.5" />} title="Momence context">
            <MomenceReviewState loading={momenceLoading} error={momenceError} chips={insights.momenceChips} />
          </ReviewBlock>
          {insights.riskSignals.length > 0 && (
            <ReviewBlock icon={<AlertTriangle className="h-3.5 w-3.5" />} title="Risk flags">
              <StructuredLineList lines={insights.riskSignals} tone="amber" />
            </ReviewBlock>
          )}
          <ReviewBeforePublish sections={insights.sections} />
        </div>
        <SmartOpsReviewBlock intelligence={smart} resolutionSteps={getDraftResolutionSteps(draft)} />
      </div>
    </div>
  );
};

type BuildableDraftTicket = Parameters<typeof buildSmartTicketIntelligence>[0]['draft'];

const SmartOpsReviewStrip: React.FC<{ intelligence: SmartTicketIntelligence; momenceLoading: boolean; momenceReady: boolean; confidenceScore: number }> = ({ intelligence, momenceLoading, momenceReady, confidenceScore }) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    <DecisionMetric label="Risk" value={`${intelligence.riskScore}`} detail={intelligence.riskLevel} tone={intelligence.riskScore >= 72 ? 'amber' : 'blue'} score={intelligence.riskScore} />
    <DecisionMetric label="Confidence" value={`${confidenceScore}%`} detail="Draft readiness" tone={confidenceScore >= 70 ? 'green' : 'amber'} score={confidenceScore} />
    <DecisionMetric label="Playbook" value={intelligence.playbook.title} detail={intelligence.playbook.owner} tone="slate" />
    <DecisionMetric label="Momence" value={momenceReady ? 'Attached' : momenceLoading ? 'Loading…' : 'Not linked'} detail={momenceReady ? 'Ready' : 'Needs check'} tone={momenceReady ? 'green' : 'amber'} score={momenceReady ? 100 : momenceLoading ? 55 : 25} />
  </div>
);

const DecisionMetric: React.FC<{ label: string; value: string; detail: string; tone: 'blue' | 'green' | 'amber' | 'slate'; score?: number }> = ({ label, value, detail, tone, score }) => {
  const tones = {
    blue: 'border-blue-100 bg-blue-50/80 text-blue-900',
    green: 'border-emerald-100 bg-emerald-50/80 text-emerald-900',
    amber: 'border-amber-100 bg-amber-50/80 text-amber-900',
    slate: 'border-slate-200 bg-white text-slate-900',
  };
  const barColors = {
    blue: 'bg-blue-500',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    slate: 'bg-slate-500',
  };
  return (
    <div className={`min-w-0 rounded-xl border px-2.5 py-2 ${tones[tone]}`}>
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-60">{label}</div>
      <div className="mt-1 truncate text-[11px] font-bold tabular-nums" title={value}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] opacity-65">{detail}</div>
      {typeof score === 'number' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/10">
          <div className={`h-full rounded-full transition-all ${barColors[tone]}`} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
        </div>
      )}
    </div>
  );
};

const SmartOpsReviewBlock: React.FC<{ intelligence: SmartTicketIntelligence; resolutionSteps?: string[] }> = ({ intelligence, resolutionSteps }) => {
  const steps = resolutionSteps && resolutionSteps.length ? resolutionSteps : intelligence.playbook.steps;
  const stepsTitle = resolutionSteps && resolutionSteps.length ? 'Resolution steps' : intelligence.playbook.title;
  return (
    <div className="space-y-2.5">
      {/* Risk score card */}
      <div className="overflow-hidden rounded-xl bg-slate-950 p-3.5 text-white shadow-[0_8px_24px_rgba(15,23,42,0.22)]">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Smart risk score</div>
            <div className="mt-1 text-3xl font-black tabular-nums leading-none">{intelligence.riskScore}</div>
          </div>
          <div className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-[9px] font-bold uppercase leading-tight text-center ${
            intelligence.riskScore >= 72
              ? 'border-amber-400/60 bg-amber-400/10 text-amber-300'
              : 'border-blue-400/60 bg-blue-400/10 text-blue-300'
          }`}>
            {intelligence.riskLevel}
          </div>
        </div>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-all ${intelligence.riskScore >= 72 ? 'bg-amber-400' : 'bg-blue-400'}`}
            style={{ width: `${intelligence.riskScore}%` }}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">{intelligence.urgencyExplanation}</p>
      </div>

      <ReviewBlock icon={<Target className="h-3.5 w-3.5" />} title={stepsTitle}>
        <StructuredLineList lines={steps} />
      </ReviewBlock>
      <ReviewBlock icon={<Zap className="h-3.5 w-3.5" />} title="Quick actions">
        <div className="flex flex-wrap gap-1.5">
          {intelligence.quickActions.map((action) => (
            <span key={action.label} title={action.prompt} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
              <ArrowRight className="h-2.5 w-2.5 text-blue-400" />
              {action.label}
            </span>
          ))}
        </div>
        <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/80 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-800">
          {intelligence.playbook.suggestedReply}
        </div>
      </ReviewBlock>
      <ReviewBlock icon={<MessageSquareText className="h-3.5 w-3.5" />} title="Next best questions">
        <StructuredLineList lines={intelligence.nextBestQuestions} />
      </ReviewBlock>
    </div>
  );
};

const ReviewBlock: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
      <span className="text-blue-400">{icon}</span>
      {title}
    </div>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const PatternNotice: React.FC<{ insights: DuplicatePatternInsights }> = ({ insights }) => (
  <div className="border-b border-blue-100 bg-blue-50/70 px-3.5 py-3 text-[11.5px] text-blue-950">
    <div className="mb-2 flex items-center gap-2 font-bold">
      <Layers3 className="h-3.5 w-3.5" />
      Pattern & duplicate check
    </div>
    <div className="grid gap-2 md:grid-cols-3">
      <MiniInsight label="Issue pattern" value={insights.patternSummary} />
      <MiniInsight label="Member pattern" value={insights.memberRepeatSummary} />
      <MiniInsight label="Recommended action" value={insights.recommendedAction} strong />
    </div>
  </div>
);

const MiniInsight: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong = false }) => (
  <div className={`rounded-lg border px-2.5 py-2 ${strong ? 'border-blue-200 bg-white text-blue-900' : 'border-white/70 bg-white/75 text-slate-700'}`}>
    <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
    <div className="text-[11px] font-medium leading-snug">{value}</div>
  </div>
);

const StructuredLineList: React.FC<{ lines: string[]; tone?: 'slate' | 'amber' }> = ({ lines, tone = 'slate' }) => (
  <div className="space-y-1">
    {lines.map((line) => (
      <div key={line} className={`flex gap-2 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${tone === 'amber' ? 'border border-amber-100 bg-amber-50 text-amber-900' : 'bg-white text-slate-600 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'}`}>
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'amber' ? 'bg-amber-400' : 'bg-blue-400'}`} />
        <span>{line}</span>
      </div>
    ))}
  </div>
);

const MomenceReviewState: React.FC<{ loading: boolean; error?: string | null; chips: string[] }> = ({ loading, error, chips }) => (
  <>
    {loading && (
      <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] font-medium text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
        Loading Momence context…
      </div>
    )}
    {error && (
      <div className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">{error}</div>
    )}
    {chips.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">
            {chip}
          </span>
        ))}
      </div>
    ) : !loading && (
      <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-400">
        No member or session context linked yet.
      </div>
    )}
  </>
);

const ReviewBeforePublish: React.FC<{ sections: TicketReviewInsights['sections'] }> = ({ sections }) => (
  <ReviewBlock icon={<Layers3 className="h-3.5 w-3.5" />} title="Review before publish">
    <div className="grid gap-2 md:grid-cols-2">
      {sections.map((section) => (
        <div key={section.title} className="rounded-xl border border-slate-100 bg-white p-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{section.title}</div>
            <div className="h-1 w-10 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-3/4 rounded-full bg-blue-400" />
            </div>
          </div>
          <div className="space-y-1">
            {section.items.slice(0, 4).map((item) => (
              <div key={item} className="truncate text-[11px] text-slate-600" title={item}>{item}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </ReviewBlock>
);

function confidenceBadge(score: number): string {
  if (score >= 85) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (score >= 65) return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (score >= 45) return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-red-50 text-red-700 ring-red-200';
}

const EditInput: React.FC<{ label: string; value: string; type?: string; onChange: (value: string) => void }> = ({ label, value, type = 'text', onChange }) => (
  <label className="block rounded-xl border border-slate-200 bg-white p-2">
    <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
    />
  </label>
);

const EditSelect: React.FC<{ label: string; value: string; options: string[]; disabled?: boolean; onChange: (value: string) => void }> = ({ label, value, options, disabled, onChange }) => (
  <label className="block rounded-xl border border-slate-200 bg-white p-2">
    <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:opacity-50"
    >
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>
);
