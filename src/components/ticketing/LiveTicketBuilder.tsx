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
  Zap,
  ArrowRight,
  Clock,
  Activity,
  Shield,
  TrendingUp,
  Circle,
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

function priorityConfig(priority?: string) {
  if (priority === 'Critical') return { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200', bar: 'bg-red-500', label: 'Critical', icon: Shield };
  if (priority === 'High') return { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 border-orange-200', bar: 'bg-orange-500', label: 'High', icon: AlertTriangle };
  if (priority === 'Medium') return { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200', bar: 'bg-blue-400', label: 'Medium', icon: Activity };
  return { dot: 'bg-slate-400', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'bg-slate-400', label: 'Low', icon: Circle };
}

function sentimentConfig(sentiment?: string) {
  if (sentiment === 'Positive') return { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
  if (sentiment === 'Concern' || sentiment === 'Negative') return { bg: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
  if (sentiment === 'Neutral') return { bg: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
  return { bg: 'bg-slate-50 text-slate-500 border-slate-200', dot: 'bg-slate-300' };
}

function intakeRouteConfig(route?: string) {
  if (route === 'Complaint') return { bg: 'bg-red-50 text-red-700 border-red-200' };
  if (route === 'Request') return { bg: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (route === 'Feedback') return { bg: 'bg-purple-50 text-purple-700 border-purple-200' };
  if (route === 'Internal Reporting') return { bg: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { bg: 'bg-slate-50 text-slate-600 border-slate-200' };
}

// Flash animation when a field first receives a value
const AnimatedFieldRow: React.FC<{
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: string;
  valueClass?: string;
}> = ({ label, value, icon, accent = 'border-slate-100 bg-slate-50/60', valueClass = 'text-slate-800' }) => {
  const [flash, setFlash] = useState(true);
  const prevValue = useRef<string>('');

  useEffect(() => {
    if (prevValue.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      prevValue.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 transition-all duration-400 ${accent} ${
        flash ? 'ring-2 ring-indigo-300/60 ring-offset-1' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {icon && <span className="shrink-0 opacity-50">{icon}</span>}
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-current opacity-55 whitespace-nowrap">{label}</span>
      </div>
      <span className={`text-right text-[11px] font-semibold truncate max-w-[130px] ${valueClass}`} title={value}>
        {value}
      </span>
    </div>
  );
};

const SectionLabel: React.FC<{ icon: React.ReactNode; title: string; count?: number }> = ({ icon, title, count }) => (
  <div className="flex items-center gap-1.5 mb-2">
    <span className="text-slate-400">{icon}</span>
    <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</span>
    {count !== undefined && (
      <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">{count}</span>
    )}
  </div>
);

// Skeleton placeholder row
const SkeletonRow: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex h-9 w-full items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 animate-pulse">
    <span className="text-[10px] font-semibold text-slate-300">{label}</span>
  </div>
);

function countFilledContext(ctx: LiveContext): number {
  return TRACKED_FIELDS.filter((k) => ctx[k]?.trim()).length;
}

// Ticket preview card — shown when draft is ready
const DraftTicketPreview: React.FC<{ draft: LiveDraft; context: LiveContext }> = ({ draft, context }) => {
  const priority = draft.priority || context.priority;
  const pCfg = priorityConfig(priority);
  const sentiment = draft.sentiment || context.memberSentiment;
  const sCfg = sentimentConfig(sentiment);
  const route = context.intakeRoute;
  const rCfg = intakeRouteConfig(route);
  const PriorityIcon = pCfg.icon;

  const studio = draft.studio || context.studio;
  const member = draft.memberName || context.memberName;
  const trainer = draft.trainer || context.trainer;
  const classType = draft.classType || context.classType;
  const assignedTo = draft.assignedTo || context.assignedTo || context.owner;
  const department = draft.department || context.department || context.team;
  const tags = Array.isArray(draft.tags) ? draft.tags.slice(0, 5) : [];

  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_24px_rgba(15,23,42,0.08)]">
      {/* Priority bar */}
      <div className={`h-1 w-full ${pCfg.bar}`} />

      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-100">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${pCfg.badge}`}>
            <PriorityIcon className="h-2.5 w-2.5" />
            {pCfg.label}
          </div>
          <div className="flex items-center gap-1.5">
            {route && (
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${rCfg.bg}`}>
                {route}
              </span>
            )}
            {sentiment && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${sCfg.bg}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${sCfg.dot}`} />
                {sentiment}
              </span>
            )}
          </div>
        </div>

        <h3 className="text-[13px] font-semibold leading-snug text-slate-900 mb-1">
          {draft.title || 'Drafting title…'}
        </h3>

        {(draft.category || draft.subCategory) && (
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <span>{draft.category}</span>
            {draft.subCategory && (
              <>
                <ChevronRight className="h-3 w-3" />
                <span>{draft.subCategory}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Key facts row */}
        <div className="grid grid-cols-2 gap-1.5">
          {studio && (
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-2 py-1.5">
              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-700 truncate">{studio}</span>
            </div>
          )}
          {member && (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1.5">
              <User className="h-3 w-3 text-emerald-500 shrink-0" />
              <span className="text-[10px] font-semibold text-emerald-800 truncate">{member}</span>
            </div>
          )}
          {classType && (
            <div className="flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-100 px-2 py-1.5">
              <Calendar className="h-3 w-3 text-blue-500 shrink-0" />
              <span className="text-[10px] font-semibold text-blue-800 truncate">{classType}</span>
            </div>
          )}
          {trainer && (
            <div className="flex items-center gap-1.5 rounded-lg bg-purple-50 border border-purple-100 px-2 py-1.5">
              <Star className="h-3 w-3 text-purple-500 shrink-0" />
              <span className="text-[10px] font-semibold text-purple-800 truncate">{trainer}</span>
            </div>
          )}
        </div>

        {/* Routing */}
        {(assignedTo || department) && (
          <div className="flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1.5">
            <ArrowRight className="h-3 w-3 text-indigo-400 shrink-0" />
            <span className="text-[10px] text-indigo-600">
              <span className="font-bold">{assignedTo}</span>
              {department && assignedTo && <span className="opacity-60"> · </span>}
              {department && <span className="opacity-75">{department}</span>}
            </span>
          </div>
        )}

        {/* Urgency reason */}
        {context.urgencyReason && (
          <div className="flex items-start gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5">
            <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-orange-700 leading-snug line-clamp-2">{context.urgencyReason}</p>
          </div>
        )}

        {/* Desired resolution */}
        {context.desiredResolution && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Desired outcome</div>
            <p className="text-[10px] text-slate-700 line-clamp-2">{context.desiredResolution}</p>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                <Tag className="h-2 w-2" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Conversation summary */}
        {draft.conversationSummary && (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
            <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400 mb-1">Summary</div>
            <p className="text-[10px] leading-relaxed text-slate-600 line-clamp-4">{draft.conversationSummary}</p>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="mx-3 mb-3 flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-50/40 px-3 py-2.5">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold text-emerald-800">Ready to review</div>
          <div className="text-[9px] text-emerald-600">Click "Review draft" in the chat to publish</div>
        </div>
        <ChevronRight className="h-4 w-4 text-emerald-400 shrink-0" />
      </div>
    </div>
  );
};

export const LiveTicketBuilder: React.FC<Props> = ({ context, activeDraft }) => {
  const filled = useMemo(() => countFilledContext(context), [context]);
  const hasDraft = Boolean(activeDraft?.title);
  const hasMember = Boolean(context.memberName || context.memberId);
  const hasSession = Boolean(context.classType || context.sessionId || context.classDateTime);
  const hasClassification = Boolean(context.category || context.priority || context.studio);
  const hasDescription = Boolean(context.description?.trim());
  const hasSentimentOrResolution = Boolean(context.memberSentiment || activeDraft?.sentiment || context.urgencyReason || context.desiredResolution);
  const hasRouting = Boolean(context.assignedTo || activeDraft?.assignedTo || context.department || activeDraft?.department || context.owner || context.team);

  const total = TRACKED_FIELDS.length;
  const progressPct = Math.min(100, Math.round((filled / 8) * 100));
  const smartStatus = getSmartStatus(context, filled, hasDraft);

  const missingFields = useMemo(
    () => MISSING_FIELD_LABELS.filter(({ key }) => !context[key]?.trim()).slice(0, 4),
    [context]
  );

  const priority = activeDraft?.priority || context.priority;
  const pCfg = priorityConfig(priority);

  // Empty state
  if (filled === 0 && !hasDraft) {
    return (
      <div className="flex h-full flex-col">
        {/* Panel header */}
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
              <Activity className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Live Ticket</div>
              <div className="text-[12px] font-semibold text-slate-500">Waiting for details…</div>
            </div>
          </div>
        </div>

        {/* Empty state body */}
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 shadow-inner">
            <BookOpen className="h-7 w-7 text-slate-300" />
          </div>
          <p className="text-[12px] font-semibold text-slate-400">Ticket fields appear here</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            As you describe the issue to Athena, captured fields will populate in real-time.
          </p>
          <div className="mt-6 w-full space-y-1.5">
            {['Category', 'Studio', 'Member', 'Priority'].map((f, i) => (
              <div
                key={f}
                className="flex h-9 w-full items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <span className="text-[10px] font-semibold text-slate-300">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50/40">
      {/* Panel header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${hasDraft ? 'bg-emerald-100' : 'bg-indigo-100'}`}>
              {hasDraft
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                : <Zap className="h-3.5 w-3.5 text-indigo-500" />
              }
            </div>
            <div>
              <div className={`text-[9px] font-bold uppercase tracking-[0.18em] ${hasDraft ? 'text-emerald-600' : 'text-indigo-500'}`}>
                Live Ticket
              </div>
              <div className="text-[12px] font-semibold text-slate-800">{smartStatus}</div>
            </div>
          </div>

          {priority && (
            <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${pCfg.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${pCfg.dot}`} />
              {pCfg.label}
            </div>
          )}
        </div>

        {/* Progress bar */}
        {!hasDraft && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold text-slate-400">Context captured</span>
              <span className="text-[9px] font-bold text-slate-500 tabular-nums">{filled}/{total}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Signal chips */}
        {!hasDraft && (context.category || context.studio || context.memberName) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {[context.category, context.studio, context.memberName].filter(Boolean).map((s) => (
              <span key={s} className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[9px] font-semibold text-blue-600">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* DRAFT PREVIEW — shown when AI has produced a draft title */}
        {hasDraft && activeDraft && (
          <DraftTicketPreview draft={activeDraft} context={context} />
        )}

        {/* LIVE CONTEXT — building up as user chats */}
        {!hasDraft && (
          <div className="space-y-3 p-3">

            {/* Classification */}
            {hasClassification && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <SectionLabel icon={<BadgeCheck className="h-3.5 w-3.5" />} title="Classification" />
                <div className="space-y-1.5">
                  {context.category && (
                    <AnimatedFieldRow label="Category" value={context.category} icon={<Tag className="h-3 w-3" />} />
                  )}
                  {context.subCategory && (
                    <AnimatedFieldRow label="Subcategory" value={context.subCategory} />
                  )}
                  {priority && (
                    <AnimatedFieldRow
                      label="Priority"
                      value={priority}
                      accent={pCfg.badge}
                      valueClass="font-bold"
                    />
                  )}
                  {(context.studio || activeDraft?.studio) && (
                    <AnimatedFieldRow
                      label="Studio"
                      value={context.studio || activeDraft?.studio || ''}
                      icon={<MapPin className="h-3 w-3" />}
                      accent="border-slate-100 bg-slate-50/60"
                    />
                  )}
                  {context.intakeRoute && (
                    <AnimatedFieldRow
                      label="Route"
                      value={context.intakeRoute}
                      accent={intakeRouteConfig(context.intakeRoute).bg}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Member */}
            {hasMember && (
              <div className="rounded-xl border border-emerald-100 bg-white p-3 shadow-sm">
                <SectionLabel icon={<User className="h-3.5 w-3.5" />} title="Member" />
                <div className="space-y-1.5">
                  {(context.memberName || activeDraft?.memberName) && (
                    <AnimatedFieldRow
                      label="Name"
                      value={context.memberName || activeDraft?.memberName || ''}
                      icon={<User className="h-3 w-3" />}
                      accent="border-emerald-100 bg-emerald-50/60"
                      valueClass="text-emerald-800 font-semibold"
                    />
                  )}
                  {(context.memberContact || activeDraft?.memberContact) && (
                    <AnimatedFieldRow label="Contact" value={context.memberContact || activeDraft?.memberContact || ''} />
                  )}
                  {context.membership && <AnimatedFieldRow label="Membership" value={context.membership} />}
                  {context.clientsAffected && <AnimatedFieldRow label="Clients affected" value={context.clientsAffected} />}
                </div>
              </div>
            )}

            {/* Session */}
            {hasSession && (
              <div className="rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
                <SectionLabel icon={<Calendar className="h-3.5 w-3.5" />} title="Session" />
                <div className="space-y-1.5">
                  {(context.classType || activeDraft?.classType) && (
                    <AnimatedFieldRow
                      label="Class"
                      value={context.classType || activeDraft?.classType || ''}
                      icon={<Calendar className="h-3 w-3" />}
                      accent="border-blue-100 bg-blue-50/60"
                    />
                  )}
                  {(context.trainer || activeDraft?.trainer) && (
                    <AnimatedFieldRow
                      label="Trainer"
                      value={context.trainer || activeDraft?.trainer || ''}
                      icon={<Star className="h-3 w-3" />}
                      accent="border-purple-100 bg-purple-50/60"
                      valueClass="text-purple-800"
                    />
                  )}
                  {context.classDateTime && (
                    <AnimatedFieldRow
                      label="Date/Time"
                      value={(() => {
                        try {
                          return new Date(context.classDateTime!).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
                        } catch {
                          return context.classDateTime!;
                        }
                      })()}
                      icon={<Clock className="h-3 w-3" />}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Sentiment & Resolution */}
            {hasSentimentOrResolution && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <SectionLabel icon={<Star className="h-3.5 w-3.5" />} title="Sentiment & Outcome" />
                <div className="space-y-1.5">
                  {(context.memberSentiment || activeDraft?.sentiment) && (
                    <AnimatedFieldRow
                      label="Sentiment"
                      value={context.memberSentiment || activeDraft?.sentiment || ''}
                      accent={sentimentConfig(context.memberSentiment || activeDraft?.sentiment).bg}
                    />
                  )}
                  {context.urgencyReason && (
                    <div className="flex items-start gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-2">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-orange-500" />
                      <div>
                        <div className="text-[8px] font-bold uppercase tracking-wide text-orange-500 mb-0.5">Urgency</div>
                        <div className="text-[10px] leading-snug text-orange-700 line-clamp-2">{context.urgencyReason}</div>
                      </div>
                    </div>
                  )}
                  {context.desiredResolution && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                      <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Desired outcome</div>
                      <div className="text-[10px] leading-snug text-slate-700 line-clamp-2">{context.desiredResolution}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Description preview */}
            {hasDescription && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <SectionLabel icon={<FileText className="h-3.5 w-3.5" />} title="Description" />
                <p className="text-[10px] leading-relaxed text-slate-600 line-clamp-5">{context.description}</p>
              </div>
            )}

            {/* Routing */}
            {hasRouting && (
              <div className="rounded-xl border border-indigo-100 bg-white p-3 shadow-sm">
                <SectionLabel icon={<MessageSquare className="h-3.5 w-3.5" />} title="Routing" />
                <div className="space-y-1.5">
                  {(context.assignedTo || context.owner || activeDraft?.assignedTo) && (
                    <AnimatedFieldRow
                      label="Assignee"
                      value={context.assignedTo || context.owner || activeDraft?.assignedTo || ''}
                      icon={<ArrowRight className="h-3 w-3" />}
                      accent="border-indigo-100 bg-indigo-50/60"
                      valueClass="text-indigo-800"
                    />
                  )}
                  {(context.department || context.team || activeDraft?.department) && (
                    <AnimatedFieldRow
                      label="Department"
                      value={context.department || context.team || activeDraft?.department || ''}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Still collecting skeleton */}
            {missingFields.length > 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-3">
                <SectionLabel icon={<TrendingUp className="h-3.5 w-3.5" />} title="Still collecting" count={missingFields.length} />
                <div className="space-y-1.5">
                  {missingFields.map(({ key, label }) => (
                    <SkeletonRow key={key} label={label} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ADDITIONAL CONTEXT — below draft preview */}
        {hasDraft && hasDescription && (
          <div className="mx-3 mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <SectionLabel icon={<FileText className="h-3.5 w-3.5" />} title="Description" />
            <p className="text-[10px] leading-relaxed text-slate-600 line-clamp-5">{context.description}</p>
          </div>
        )}

        {/* Conversation summary — only in pre-draft mode */}
        {!hasDraft && activeDraft?.conversationSummary && (
          <div className="mx-3 mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <SectionLabel icon={<Flame className="h-3.5 w-3.5" />} title="Conversation summary" />
            <p className="text-[10px] leading-relaxed text-slate-600 line-clamp-5">{activeDraft.conversationSummary}</p>
          </div>
        )}

      </div>
    </div>
  );
};
