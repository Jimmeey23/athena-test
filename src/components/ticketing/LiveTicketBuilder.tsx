import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  FileText,
  Flame,
  MapPin,
  MessageSquare,
  Star,
  Tag,
  User,
} from 'lucide-react';

interface LiveContext {
  intakeRoute?: string;
  category?: string;
  subCategory?: string;
  priority?: string;
  studio?: string;
  trainer?: string;
  classType?: string;
  classDateTime?: string;
  memberName?: string;
  memberContact?: string;
  membership?: string;
  memberId?: string;
  sessionId?: string;
  reportedBy?: string;
  assignedTo?: string;
  owner?: string;
  department?: string;
  team?: string;
  memberSentiment?: string;
  urgencyReason?: string;
  desiredResolution?: string;
  description?: string;
  clientsAffected?: string;
  [key: string]: string | undefined;
}

interface LiveDraft {
  title?: string;
  category?: string;
  subCategory?: string;
  priority?: string;
  studio?: string;
  trainer?: string | null;
  classType?: string | null;
  memberName?: string | null;
  memberContact?: string | null;
  assignedTo?: string | null;
  department?: string | null;
  sentiment?: string;
  conversationSummary?: string;
  tags?: string[];
}

interface Props {
  context: LiveContext;
  activeDraft?: LiveDraft | null;
}

const TRACKED_FIELDS: (keyof LiveContext)[] = [
  'category',
  'subCategory',
  'studio',
  'priority',
  'memberName',
  'classType',
  'trainer',
  'membership',
  'memberSentiment',
  'desiredResolution',
  'urgencyReason',
];

const MISSING_FIELD_LABELS: { key: keyof LiveContext; label: string }[] = [
  { key: 'memberName', label: 'Member name' },
  { key: 'studio', label: 'Studio' },
  { key: 'category', label: 'Category' },
  { key: 'classType', label: 'Class type' },
  { key: 'trainer', label: 'Trainer' },
  { key: 'priority', label: 'Priority' },
  { key: 'memberSentiment', label: 'Sentiment' },
  { key: 'desiredResolution', label: 'Desired resolution' },
];

function getSmartStatus(ctx: LiveContext, filled: number, hasDraft: boolean): string {
  if (hasDraft) return 'Draft ready';
  if (filled === 0) return 'Waiting for details…';
  if (!ctx.memberName) return 'Waiting for member name…';
  if (!ctx.studio) return 'Need studio location…';
  if (!ctx.category) return 'Identifying issue type…';
  if (!ctx.classType && !ctx.trainer) return 'Need class details…';
  if (!ctx.priority) return 'Assessing priority…';
  if (filled >= 6) return 'Almost there…';
  return 'Capturing context…';
}

function priorityColors(priority?: string) {
  if (priority === 'Critical') return 'bg-red-100 text-red-700 border-red-200';
  if (priority === 'High') return 'bg-orange-100 text-orange-700 border-orange-200';
  if (priority === 'Medium') return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function sentimentColors(sentiment?: string) {
  if (sentiment === 'Positive') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (sentiment === 'Concern' || sentiment === 'Negative') return 'bg-red-100 text-red-700 border-red-200';
  if (sentiment === 'Neutral') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-slate-100 text-slate-500 border-slate-200';
}

// Flashes a highlight ring when a field first appears
const AnimatedFieldChip: React.FC<{
  label: string;
  value: string;
  tone?: 'default' | 'priority' | 'sentiment';
}> = ({ label, value, tone = 'default' }) => {
  const [flash, setFlash] = useState(true);
  const prevValue = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (prevValue.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 800);
      prevValue.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  const toneClass =
    tone === 'priority'
      ? priorityColors(value)
      : tone === 'sentiment'
      ? sentimentColors(value)
      : 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 transition-all duration-300 ${toneClass} ${
        flash ? 'ring-2 ring-indigo-300 ring-offset-1' : ''
      }`}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-60">{label}</span>
      <span className="ml-2 text-right text-[11px] font-semibold truncate max-w-[120px]" title={value}>
        {value}
      </span>
    </div>
  );
};

const SectionLabel: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <div className="flex items-center gap-1.5 mb-2">
    <span className="text-slate-400">{icon}</span>
    <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</span>
  </div>
);

function countFilledContext(ctx: LiveContext): number {
  return TRACKED_FIELDS.filter((k) => ctx[k]?.trim()).length;
}

export const LiveTicketBuilder: React.FC<Props> = ({ context, activeDraft }) => {
  const filled = useMemo(() => countFilledContext(context), [context]);
  const hasDraft = Boolean(activeDraft?.title);
  const hasMember = Boolean(context.memberName || context.memberId);
  const hasSession = Boolean(context.classType || context.sessionId || context.classDateTime);
  const hasClassification = Boolean(context.category || context.priority || context.studio);
  const hasDescription = Boolean(context.description?.trim());

  const totalSignals = useMemo(() => {
    const signals: string[] = [];
    if (context.memberName) signals.push(context.memberName);
    if (context.studio) signals.push(context.studio);
    if (context.category) signals.push(context.category);
    return signals;
  }, [context]);

  const total = TRACKED_FIELDS.length;
  const progressPct = Math.min(100, Math.round((filled / 8) * 100));
  const smartStatus = getSmartStatus(context, filled, hasDraft);

  const missingFields = useMemo(
    () => MISSING_FIELD_LABELS.filter(({ key }) => !context[key]?.trim()).slice(0, 4),
    [context]
  );

  if (filled === 0 && !hasDraft) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <BookOpen className="h-7 w-7 text-slate-300" />
        </div>
        <p className="text-[12px] font-semibold text-slate-400">Ticket fields appear here</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          As you describe the issue to Athena, captured fields will populate in real-time.
        </p>
        <div className="mt-6 space-y-1.5 w-full">
          {['Category', 'Studio', 'Member', 'Priority'].map((f) => (
            <div key={f} className="h-8 w-full rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center px-3">
              <span className="text-[10px] font-semibold text-slate-300">{f}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-gradient-to-r from-white via-indigo-50/20 to-white px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-indigo-600">Live Ticket</div>
            <div className="text-[13px] font-semibold text-slate-900">{smartStatus}</div>
          </div>
          {hasDraft && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              Draft
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] font-bold text-slate-400 tabular-nums">
            {filled}/{total}
          </span>
        </div>
        {totalSignals.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {totalSignals.map((s) => (
              <span key={s} className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[9px] font-semibold text-blue-600">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">

          {/* Draft title */}
          {hasDraft && activeDraft?.title && (
            <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-indigo-500 mb-1">Draft Title</div>
              <div className="text-[12px] font-semibold text-slate-800 leading-snug">{activeDraft.title}</div>
              {activeDraft.tags && activeDraft.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {activeDraft.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-0.5 rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[9px] text-indigo-600">
                      <Tag className="h-2.5 w-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Classification */}
          {hasClassification && (
            <div>
              <SectionLabel icon={<BadgeCheck className="h-3.5 w-3.5" />} title="Classification" />
              <div className="space-y-1.5">
                {context.category && <AnimatedFieldChip label="Category" value={context.category} />}
                {context.subCategory && <AnimatedFieldChip label="Subcategory" value={context.subCategory} />}
                {(context.priority || activeDraft?.priority) && (
                  <AnimatedFieldChip label="Priority" value={context.priority || activeDraft?.priority || ''} tone="priority" />
                )}
                {(context.studio || activeDraft?.studio) && (
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Studio</span>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                      <MapPin className="h-3 w-3 text-slate-400" />
                      {context.studio || activeDraft?.studio}
                    </span>
                  </div>
                )}
                {context.intakeRoute && <AnimatedFieldChip label="Route" value={context.intakeRoute} />}
              </div>
            </div>
          )}

          {/* Member */}
          {hasMember && (
            <div>
              <SectionLabel icon={<User className="h-3.5 w-3.5" />} title="Member" />
              <div className="space-y-1.5">
                {(context.memberName || activeDraft?.memberName) && (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-600">Name</span>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                      <User className="h-3 w-3 text-emerald-400" />
                      {context.memberName || activeDraft?.memberName}
                    </span>
                  </div>
                )}
                {(context.memberContact || activeDraft?.memberContact) && (
                  <AnimatedFieldChip label="Contact" value={context.memberContact || activeDraft?.memberContact || ''} />
                )}
                {context.membership && <AnimatedFieldChip label="Membership" value={context.membership} />}
                {context.clientsAffected && <AnimatedFieldChip label="Clients affected" value={context.clientsAffected} />}
              </div>
            </div>
          )}

          {/* Session */}
          {hasSession && (
            <div>
              <SectionLabel icon={<Calendar className="h-3.5 w-3.5" />} title="Session" />
              <div className="space-y-1.5">
                {(context.classType || activeDraft?.classType) && (
                  <AnimatedFieldChip label="Class" value={context.classType || activeDraft?.classType || ''} />
                )}
                {(context.trainer || activeDraft?.trainer) && (
                  <AnimatedFieldChip label="Trainer" value={context.trainer || activeDraft?.trainer || ''} />
                )}
                {context.classDateTime && (
                  <AnimatedFieldChip
                    label="Date/Time"
                    value={(() => {
                      try {
                        return new Date(context.classDateTime!).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
                      } catch {
                        return context.classDateTime!;
                      }
                    })()}
                  />
                )}
              </div>
            </div>
          )}

          {/* Sentiment & Resolution */}
          {(context.memberSentiment || activeDraft?.sentiment || context.urgencyReason || context.desiredResolution) && (
            <div>
              <SectionLabel icon={<Star className="h-3.5 w-3.5" />} title="Sentiment & Resolution" />
              <div className="space-y-1.5">
                {(context.memberSentiment || activeDraft?.sentiment) && (
                  <AnimatedFieldChip label="Sentiment" value={context.memberSentiment || activeDraft?.sentiment || ''} tone="sentiment" />
                )}
                {context.urgencyReason && (
                  <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-orange-500" />
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-orange-500">Urgency</div>
                      <div className="text-[11px] text-orange-700">{context.urgencyReason}</div>
                    </div>
                  </div>
                )}
                {context.desiredResolution && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Desired resolution</div>
                    <div className="mt-0.5 text-[11px] text-slate-700">{context.desiredResolution}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description preview */}
          {hasDescription && (
            <div>
              <SectionLabel icon={<FileText className="h-3.5 w-3.5" />} title="Description" />
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2">
                <p className="text-[11px] leading-relaxed text-slate-600 line-clamp-4">{context.description}</p>
              </div>
            </div>
          )}

          {/* Routing */}
          {(context.assignedTo || activeDraft?.assignedTo || context.department || activeDraft?.department) && (
            <div>
              <SectionLabel icon={<MessageSquare className="h-3.5 w-3.5" />} title="Routing" />
              <div className="space-y-1.5">
                {(context.assignedTo || context.owner || activeDraft?.assignedTo) && (
                  <AnimatedFieldChip label="Assignee" value={context.assignedTo || context.owner || activeDraft?.assignedTo || ''} />
                )}
                {(context.department || context.team || activeDraft?.department) && (
                  <AnimatedFieldChip label="Department" value={context.department || context.team || activeDraft?.department || ''} />
                )}
              </div>
            </div>
          )}

          {/* Conversation summary */}
          {hasDraft && activeDraft?.conversationSummary && (
            <div>
              <SectionLabel icon={<Flame className="h-3.5 w-3.5" />} title="Summary" />
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-[11px] leading-relaxed text-slate-600 line-clamp-5">{activeDraft.conversationSummary}</p>
              </div>
            </div>
          )}

          {/* Missing fields skeleton — only before draft is ready */}
          {!hasDraft && missingFields.length > 0 && (
            <div>
              <SectionLabel icon={<BookOpen className="h-3.5 w-3.5" />} title="Still collecting" />
              <div className="space-y-1.5">
                {missingFields.map(({ key, label }) => (
                  <div
                    key={key}
                    className="h-8 w-full rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center px-3 animate-pulse"
                  >
                    <span className="text-[10px] font-semibold text-slate-300">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Draft ready CTA */}
          {hasDraft && (
            <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <div>
                  <div className="text-[11px] font-bold text-emerald-800">Draft ready to review</div>
                  <div className="text-[10px] text-emerald-600">Click "Review draft" in the chat to publish.</div>
                </div>
                <ChevronRight className="ml-auto h-4 w-4 text-emerald-400" />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
