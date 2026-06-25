import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Send, Sparkles, CheckCircle2, Paperclip, X, Mic, Square, ChevronDown, Check, HelpCircle, ClipboardCheck, Gauge, GraduationCap, LayoutTemplate, Download, FileText, FileCode2, ImageDown, Copy } from 'lucide-react';
import { LiveTicketBuilder } from './LiveTicketBuilder';
import InteractiveRobotSpline from '@/components/InteractiveRobotSpline';
import { ROBOT_SPLINE_URL } from '@/lib/galleryImages';
import { getErrorMessage } from '@/lib/error-formatting';
import { TicketPreviewCard } from './TicketPreviewCard';
import { ContextPicker, Context } from './ContextPicker';
import { useTickets } from './useTickets';
import { useBackendAuth } from '@/contexts/useBackendAuth';
import {
  getMomenceMemberMemberships,
  getMomenceSessionBookings,
  listMomenceHostMembershipOptions,
  loadMomenceSessionsProgressively,
  loadMomenceTicketContext,
  MomenceInsightSummary,
  MomenceMemberOption,
  MomenceMembership,
  MomenceSessionBooking,
  MomenceSessionOption,
  searchMomenceMembers,
  searchMomenceSessions,
} from '@/lib/momence-api';
import {
  CLASS_IMPACT_TYPE_OPTIONS,
  CLIENTS_AFFECTED_OPTIONS,
  captureMemberFeedbackFromText,
  getIntakeFieldDefinition,
  getMissingIntakeFields,
  isMissingIntakeValue,
  IntakeContext,
} from '@/lib/intake-rules';
import {
  shouldAcceptAiDetailForm,
  shouldAcceptInferredSubCategory,
  shouldHoldDraftForMoreInfo,
  shouldReplaceInferredCategory,
} from '@/lib/intake-response-state';
import {
  CATEGORIES,
  FREEZE_REASONS,
  HOSTED_CLASS_FEEDBACK_AREAS,
  CLASS_TYPES,
  INTAKE_ROUTES,
  MEMBER_SENTIMENT_OPTIONS,
  PRIORITY_SLA,
  REQUEST_TYPES,
  ROLLOVER_REASONS,
  STUDIOS,
  TRAINERS,
  Ticket,
  resolveTicketAssignee,
  resolveTicketDepartment,
} from '@/lib/ticketing-data';
import { buildRelatedTicketNotice, findRelatedSubmittedTickets } from '@/lib/ticket-duplicate-matching';
import { invokeTicketingFunction, withTimeout } from '@/lib/ticketing-functions';
import { buildAthenaDraftRequestBody } from '@/lib/ticket-ai-chat-payload';
import {
  buildOperationalTicketDescription,
  draftDescriptionNeedsRewrite,
  normalizeDraftContextForSource,
  summarizeOperationalReport,
} from '@/lib/ticket-draft-formatting';
import { buildTicketReviewInsights } from '@/lib/ticket-review';
import { buildDuplicatePatternInsights, buildVoiceExtractionHints, optimizeIntakePromptForAthena } from '@/lib/smart-ops-intelligence';
import { getGreetingQuickActions, isCasualGreeting } from '@/lib/athena-chat-intent';
import { shouldUseOptionButtons } from '@/lib/intake-option-buttons';
import {
  buildNaturalSingleFieldPrompt,
  getReporterFirstName,
  limitConversationalFieldBatch,
} from '@/lib/intake-conversation-plan';
import {
  htmlForChatTranscript,
  plainTextForChatTranscript,
  transcriptFileBaseName,
} from '@/lib/chat-export';
import {
  CONTEXT_TEMPLATES,
  ContextTemplate,
  ContextTemplateField,
  HostedClassAttendeeFeedback,
  HostedClassFeedbackInput,
  HostedClassSessionSummary,
  buildContextTemplateText,
  buildHostedClassFeedbackText,
} from '@/lib/intake-templates';
import { trainerImageUrl, trainerInitials } from '@/lib/trainer-images';
import {
  TRAINER_REVIEW_TEMPLATES,
  TrainerEvaluationInput,
  TrainerEvaluationScore,
  TrainerReviewTemplate,
  buildTrainerEvaluationText,
  buildTrainerReviewRecord,
  isTrainerEvaluationProfileOnly,
  parseTrainerEvaluationText,
  saveTrainerReview,
} from '@/lib/trainer-profiles';
import { SlaCountdown } from './SlaCountdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface SuggestedChip {
  label: string;
  value: string;
  field: string;
}

type DetailFieldType = 'select' | 'text' | 'textarea' | 'date' | 'datetime-local' | 'number' | 'rating';

interface DetailFormField {
  id: string;
  label: string;
  type: DetailFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  dependsOn?: string;
  dependsOnValue?: string;
  section?: string;
  scoreWeight?: number;
}

interface DetailForm {
  id?: string;
  title: string;
  description?: string;
  fields: DetailFormField[];
  submitLabel?: string;
}

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

interface PendingAttachment {
  id: string;
  file: File;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type DetailContext = Context & IntakeContext;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  aiGenerated?: boolean;
  ticket?: DraftTicket | null;
  trainerEvaluation?: TrainerEvaluationInput;
  suggestedChips?: SuggestedChip[];
  ticketId?: string;
  published?: boolean;
  detailForm?: DetailForm | null;
  publishedTicket?: Ticket;
  debugTrace?: Record<string, unknown> | null;
}

interface AiIntakeResponse {
  conversationId?: string;
  needsMoreInfo?: boolean;
  reply?: string;
  detailForm?: DetailForm | null;
  ticket?: DraftTicket | null;
  suggestedChips?: SuggestedChip[];
  inferredContext?: Partial<DetailContext>;
  missingFields?: string[];
  publishable?: boolean;
  urgencyReason?: string;
  debugTrace?: Record<string, unknown> | null;
}

const GREETING: Message = {
  id: 'greet',
  role: 'assistant',
  content: "Hey! I'm Athena 👋 What would you like to log today? Tell me what happened and I'll take it from there.",
};

function buildGreetingMessage(reporterName?: string): Message {
  const firstName = getReporterFirstName(reporterName);
  return {
    ...GREETING,
    content: firstName
      ? `Hey ${firstName}! 👋 What would you like to log today? Just describe what happened and I'll handle the rest.`
      : "Hey! I'm Athena 👋 What would you like to log today? Tell me what happened and I'll take it from there.",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function writingPauseMs(content: string): number {
  const length = content.trim().length;
  return Math.min(1150, Math.max(420, 300 + length * 4));
}

function isAthenaDebugTraceEnabled(): boolean {
  if (import.meta.env.VITE_ATHENA_DEBUG_TRACE === 'true') return true;
  if (typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  const queryValue = url.searchParams.get('athenaTrace');
  if (queryValue !== null) {
    return !/^(0|false|off)$/i.test(queryValue);
  }
  return window.localStorage.getItem('athena-debug-trace') === '1';
}

const ATHENA_CHAT_RESPONSE_TIMEOUT_MS = 30_000;
const ATHENA_CHAT_TIMEOUT_MESSAGE = 'Athena chat response timed out';
const ATHENA_AI_PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Haiku',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
};

function aiProviderBadgeLabel(provider?: string): string {
  const normalizedProvider = (provider || 'openai').trim().toLowerCase();
  return ATHENA_AI_PROVIDER_LABELS[normalizedProvider] || 'OpenAI';
}

const USER_TONES = [
  {
    avatar: 'border-blue-200 bg-white text-blue-600 shadow-[0_12px_28px_rgba(37,99,235,0.16)]',
    bubble: 'rounded-tr-md border border-l-4 border-blue-200 border-l-blue-500 bg-white text-slate-800 shadow-[0_18px_44px_rgba(37,99,235,0.14)]',
    more: 'text-blue-700 hover:text-blue-900',
  },
  {
    avatar: 'border-cyan-200 bg-white text-cyan-600 shadow-[0_12px_28px_rgba(8,145,178,0.14)]',
    bubble: 'rounded-tr-md border border-l-4 border-cyan-200 border-l-cyan-500 bg-white text-slate-800 shadow-[0_18px_44px_rgba(8,145,178,0.13)]',
    more: 'text-cyan-700 hover:text-cyan-900',
  },
  {
    avatar: 'border-indigo-200 bg-white text-indigo-600 shadow-[0_12px_28px_rgba(79,70,229,0.14)]',
    bubble: 'rounded-tr-md border border-l-4 border-indigo-200 border-l-indigo-500 bg-white text-slate-800 shadow-[0_18px_44px_rgba(79,70,229,0.13)]',
    more: 'text-indigo-700 hover:text-indigo-900',
  },
  {
    avatar: 'border-sky-200 bg-white text-sky-600 shadow-[0_12px_28px_rgba(2,132,199,0.15)]',
    bubble: 'rounded-tr-md border border-l-4 border-sky-200 border-l-sky-500 bg-white text-slate-800 shadow-[0_18px_44px_rgba(2,132,199,0.14)]',
    more: 'text-sky-700 hover:text-sky-900',
  },
];

const getDisplayError = getErrorMessage;

function getReporterName(user: ReturnType<typeof useBackendAuth>['user']): string {
  const metadata = user?.user_metadata || {};
  const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '';
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
  return fullName || name || user?.email || 'Authenticated user';
}

const DETAIL_FORM_FIELD_LIBRARY: Record<string, DetailFormField> = {
  intakeRoute: {
    id: 'intakeRoute',
    label: 'Intake Route',
    type: 'select',
    required: true,
    options: INTAKE_ROUTES,
  },
  requestType: {
    id: 'requestType',
    label: 'Specific Ticket Type',
    type: 'select',
    required: true,
    options: REQUEST_TYPES,
  },
  clientsAffected: {
    id: 'clientsAffected',
    label: 'Were any clients affected?',
    type: 'select',
    required: true,
    options: [...CLIENTS_AFFECTED_OPTIONS],
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    type: 'select',
    required: true,
    options: STUDIOS,
  },
  category: {
    id: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: Object.keys(CATEGORIES),
  },
  subCategory: {
    id: 'subCategory',
    label: 'Issue Type',
    type: 'select',
    required: true,
    dependsOn: 'category',
    options: Object.values(CATEGORIES).flat(),
  },
  trainer: {
    id: 'trainer',
    label: 'Instructor',
    type: 'select',
    options: TRAINERS,
  },
  classType: {
    id: 'classType',
    label: 'Class / Session',
    type: 'select',
    required: true,
    options: [],
  },
  membership: {
    id: 'membership',
    label: 'Package / Membership',
    type: 'select',
    options: [],
  },
  memberName: {
    id: 'memberName',
    label: 'Member Name',
    type: 'text',
    required: true,
  },
  memberContact: {
    id: 'memberContact',
    label: 'Member Contact',
    type: 'text',
    required: true,
  },
  priority: {
    id: 'priority',
    label: 'Priority',
    type: 'select',
    required: true,
    options: Object.keys(PRIORITY_SLA),
  },
  description: {
    id: 'description',
    label: 'Describe the issue in detail',
    type: 'textarea',
    required: true,
  },
  desiredResolution: {
    id: 'desiredResolution',
    label: 'Requested resolution',
    type: 'textarea',
  },
  incidentDateTime: {
    id: 'incidentDateTime',
    label: 'Approx. Incident Date / Time',
    type: 'datetime-local',
  },
  memberSentiment: {
    id: 'memberSentiment',
    label: 'Member Sentiment',
    type: 'select',
    options: MEMBER_SENTIMENT_OPTIONS,
  },
  classImpactType: {
    id: 'classImpactType',
    label: 'What type of class/session impact was reported?',
    type: 'select',
    required: true,
    options: [...CLASS_IMPACT_TYPE_OPTIONS],
  },
  classImpactDetails: {
    id: 'classImpactDetails',
    label: 'How was the class/session affected?',
    type: 'textarea',
    required: true,
  },
  freezeStartDate: {
    id: 'freezeStartDate',
    label: 'Requested Freeze Start Date',
    type: 'date',
    required: true,
  },
  freezeEndDate: {
    id: 'freezeEndDate',
    label: 'Requested Freeze End Date',
    type: 'date',
    required: true,
  },
  freezeReason: {
    id: 'freezeReason',
    label: 'Freeze Reason Stated by Member',
    type: 'select',
    required: true,
    options: FREEZE_REASONS,
  },
  classesRemaining: {
    id: 'classesRemaining',
    label: 'Classes / Credits Remaining',
    type: 'number',
  },
  packageExpiryDate: {
    id: 'packageExpiryDate',
    label: 'Current Package Expiry Date',
    type: 'date',
  },
  requestedRolloverDate: {
    id: 'requestedRolloverDate',
    label: 'Requested Roll Over / Extension Date',
    type: 'date',
    required: true,
  },
  rolloverReason: {
    id: 'rolloverReason',
    label: 'Roll Over Reason',
    type: 'select',
    required: true,
    options: ROLLOVER_REASONS,
  },
  partnerName: {
    id: 'partnerName',
    label: 'Hosted Class Partner / Influencer',
    type: 'text',
    required: true,
  },
  hostedFeedbackArea: {
    id: 'hostedFeedbackArea',
    label: 'Hosted Class Feedback Area',
    type: 'select',
    required: true,
    options: HOSTED_CLASS_FEEDBACK_AREAS,
  },
  attendeeCount: {
    id: 'attendeeCount',
    label: 'Approx. Attendee Count',
    type: 'number',
  },
  prospectQuality: {
    id: 'prospectQuality',
    label: 'Prospect Quality / Conversion Signal',
    type: 'select',
    options: ['High Fit', 'Moderate Fit', 'Low Fit', 'Existing Members Mostly', 'Unable to Determine'],
  },
  followUpPreference: {
    id: 'followUpPreference',
    label: 'Follow-up Preference Indicated',
    type: 'select',
    options: ['Phone Call', 'WhatsApp', 'Email', 'Instagram DM', 'In-Person Next Visit', 'No Follow-up Requested'],
  },
};

function getDetailField(id: string): DetailFormField | undefined {
  return DETAIL_FORM_FIELD_LIBRARY[id] || getIntakeFieldDefinition(id);
}

function downloadTextFile(filename: string, text: string, contentType: string) {
  const blob = new Blob([text], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function collectDocumentStyleText(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n');
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function absoluteImageSources(root: HTMLElement) {
  root.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src');
    if (!source) return;
    try {
      image.setAttribute('src', new URL(source, window.location.href).href);
    } catch {
      // Keep the original source if URL normalization fails.
    }
  });
}

async function imageLoaded(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === 'function') {
    await image.decode();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('PNG export image render failed'));
  });
}

async function pngDataUrlForElementScreenshot(node: HTMLElement): Promise<string> {
  const width = Math.max(1, node.clientWidth);
  const height = Math.max(1, node.clientHeight);
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const clone = node.cloneNode(true) as HTMLElement;
  absoluteImageSources(clone);
  clone.style.width = `${Math.max(node.scrollWidth, width)}px`;
  clone.style.height = `${Math.max(node.scrollHeight, height)}px`;
  clone.style.maxWidth = 'none';
  clone.style.maxHeight = 'none';
  clone.style.overflow = 'visible';
  clone.style.transform = `translate(${-node.scrollLeft}px, ${-node.scrollTop}px)`;
  clone.style.transformOrigin = 'top left';

  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = 'hidden';
  wrapper.style.background = '#f3f4f6';

  const style = document.createElement('style');
  style.textContent = collectDocumentStyleText();
  wrapper.append(style, clone);

  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject>`,
    '</svg>',
  ].join('');
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await imageLoaded(image);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for PNG export');
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = '#f3f4f6';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function detailFieldWithContext(base: DetailFormField, ctx?: DetailContext): DetailFormField {
  if (base.id === 'subCategory') {
    const category = ctx?.category;
    const options = category && CATEGORIES[category]?.length ? CATEGORIES[category] : base.options;
    return { ...base, options };
  }
  return base;
}

function normalizeDetailForm(input: unknown, ctx?: DetailContext): DetailForm | null {
  if (!input || typeof input !== 'object') return null;
  const form = input as Partial<DetailForm> & { fields?: Array<Partial<DetailFormField> | string> };
  const seen = new Set<string>();
  const allowedTypes = new Set<DetailFieldType>(['select', 'text', 'textarea', 'date', 'datetime-local', 'number']);
  const fields = (form.fields || [])
    .map((field) => {
      if (typeof field === 'string') {
        const normalizedId = field === 'requestType' ? 'intakeRoute' : field;
        if (seen.has(normalizedId)) return null;
        seen.add(normalizedId);
        const base = getDetailField(normalizedId);
        return base ? { ...detailFieldWithContext(base, ctx), required: true } : undefined;
      }
      const id = field.id ? (String(field.id) === 'requestType' ? 'intakeRoute' : String(field.id)) : '';
      if (id === 'reportedBy') return null;
      const base = getDetailField(id);
      if (seen.has(id)) return null;
      seen.add(id);
      if (base) {
        const contextualBase = detailFieldWithContext(base, ctx);
        // AI-provided labels can be contextual, but known fields keep the app's
        // standard option lists so irrelevant choices do not leak into the form.
        const aiLabel = typeof (field as Partial<DetailFormField>).label === 'string' && (field as Partial<DetailFormField>).label!.trim()
          ? (field as Partial<DetailFormField>).label!.trim()
          : null;
        const rawAiOptions = (field as Partial<DetailFormField>).options;
        const aiOptions = Array.isArray(rawAiOptions) && rawAiOptions.length > 0
          ? rawAiOptions.map(String).filter(Boolean).slice(0, 30)
          : null;
        const standardOptions = contextualBase.options?.length ? contextualBase.options : null;
        return {
          ...contextualBase,
          ...field,
          id: contextualBase.id,
          label: aiLabel || contextualBase.label,
          options: standardOptions || aiOptions || contextualBase.options,
          required: field.required ?? contextualBase.required,
        } as DetailFormField;
      }

      const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : '';
      const type = field.type && allowedTypes.has(field.type) ? field.type : 'text';
      if (!id || !label) return null;
      return {
        id: id.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 80),
        label,
        type,
        required: field.required !== false,
        options: Array.isArray(field.options) ? field.options.map(String).filter(Boolean).slice(0, 30) : undefined,
        dependsOn: typeof field.dependsOn === 'string' ? field.dependsOn : undefined,
      } as DetailFormField;
    })
    .filter(Boolean) as DetailFormField[];

  if (fields.length === 0) return null;
  return {
    title: form.title || 'Add the missing ticket details',
    description: form.description,
    fields,
    submitLabel: form.submitLabel || 'Continue drafting',
  };
}

function chipsForSingleField(field: DetailFormField, ctx: DetailContext): SuggestedChip[] {
  if (ctx[field.id]) return [];
  if (field.type !== 'select') return [];
  const options = field.id === 'subCategory' && ctx.category ? CATEGORIES[ctx.category] || [] : field.options || [];
  if (field.id === 'membership' || options.length === 0) return [];
  return options.slice(0, 10).map((option) => ({
    label: option,
    value: option,
    field: field.id,
  }));
}

function applyDetailValue(ctx: DetailContext, field: string, value: string): DetailContext {
  const next = { ...ctx };
  if (field === 'studio') next.studio = value;
  else if (field === 'trainer') next.trainer = value;
  else if (field === 'classType') next.classType = value;
  else if (field === 'memberName') next.memberName = value;
  else if (field === 'memberContact') next.memberContact = value;
  else if (field === 'category') {
    next.category = value;
    next.subCategory = undefined;
  } else if (field === 'subCategory') next.subCategory = value;
  else if (field === 'reportedBy') next.reportedBy = value;
  else if (field === 'assignedTo' || field === 'owner') next.assignedTo = value;
  else if (field === 'department' || field === 'team') next.department = value;
  else next[field] = value;
  return next;
}

function normalizeInferredContext(input: unknown): Partial<DetailContext> {
  if (!input || typeof input !== 'object') return {};
  const value = input as Record<string, unknown>;
  const next: Partial<DetailContext> = {};
  const assignString = (key: keyof DetailContext) => {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) next[key] = candidate.trim();
  };

  // Classification fields
  assignString('intakeRoute');
  assignString('requestType');
  assignString('category');
  assignString('subCategory');
  assignString('priority');
  assignString('memberSentiment');
  assignString('resolutionRequired');
  assignString('desiredResolution');
  assignString('urgencyReason');
  assignString('clientsAffected');
  assignString('membership');
  assignString('classImpactType');
  assignString('classImpactDetails');
  // Entity/location fields — previously missing, causing the AI's inferences to be silently dropped
  assignString('studio');
  assignString('trainer');
  assignString('memberName');
  assignString('memberContact');
  assignString('classType');
  assignString('classDateTime');
  assignString('incidentDateTime');
  assignString('description');

  return next;
}

function mergeInferredContext(ctx: DetailContext, inferred: Partial<DetailContext>, fallbackUrgency?: string): DetailContext {
  const next: DetailContext = { ...ctx };
  for (const [key, value] of Object.entries(inferred)) {
    if (!value) continue;
    if (
      (key === 'category' || key === 'subCategory') &&
      next.category === 'Hosted Class & Partnerships' &&
      (value === 'General Feedback' || value === 'Other')
    ) {
      continue;
    }
    if (key === 'category' && next.category !== value) {
      if (!shouldReplaceInferredCategory(next.category, value)) continue;
      next.category = value;
      next.subCategory = undefined;
      continue;
    }
    if (key === 'subCategory' && !shouldAcceptInferredSubCategory(next.category, value, CATEGORIES[next.category || ''])) {
      continue;
    }
    next[key] = value;
  }
  if (fallbackUrgency && !next.urgencyReason) next.urgencyReason = fallbackUrgency;
  return next;
}

function fieldHasContextValue(field: DetailFormField, ctx: DetailContext): boolean {
  const value = ctx[field.id];
  const hasAnyIntakeValue = (...values: unknown[]) => values.some((candidate) => !isMissingIntakeValue(candidate));
  if (field.id === 'memberName') return hasAnyIntakeValue(ctx.memberId, ctx.memberName);
  if (field.id === 'memberContact') return hasAnyIntakeValue(ctx.memberContact, ctx.memberId);
  if (field.id === 'classType') return hasAnyIntakeValue(ctx.sessionId, ctx.classType);
  if (field.id === 'membership') return hasAnyIntakeValue(ctx.membership);
  return !isMissingIntakeValue(value);
}

function pruneDetailForm(form: DetailForm | null, ctx: DetailContext): DetailForm | null {
  if (!form) return null;
  const fields = form.fields.filter((field) => !fieldHasContextValue(field, ctx));
  if (fields.length === 0) return null;
  return { ...form, fields };
}

function filterAiDetailForm(form: DetailForm | null, ctx: DetailContext, requiredFields: Set<string>): DetailForm | null {
  if (!form) return null;
  // AI drives the intake. Keep its contextual questions instead of filtering them
  // through local deterministic guard rules.
  const fields = form.fields.map((field) => {
    if (field.id === 'reportedBy') return false;
    return requiredFields.has(field.id) ? { ...field, required: true } : field;
  }).filter(Boolean) as DetailFormField[];

  if (fields.length === 0) return null;
  return { ...form, fields };
}

function mergeDetailForms(primary: DetailForm | null, secondary: DetailForm | null): DetailForm | null {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const seen = new Set<string>();
  const fields = [...primary.fields, ...secondary.fields].filter((field) => {
    if (seen.has(field.id)) return false;
    seen.add(field.id);
    return true;
  });

  return {
    ...primary,
    description: primary.description || secondary.description,
    fields,
    submitLabel: primary.submitLabel || secondary.submitLabel,
  };
}

function batchDetailFormForConversation(form: DetailForm | null): DetailForm | null {
  if (!form) return null;
  const fields = limitConversationalFieldBatch(form.fields);
  if (fields.length === form.fields.length) return form;
  return {
    ...form,
    title: fields.length === 1 ? fields[0].label : form.title,
    description: undefined,
    fields,
    submitLabel: 'Continue',
  };
}

function detailFormFromQuestionText(text: string, ctx: DetailContext): DetailForm | null {
  const questionLines = text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[).\s-]*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.endsWith('?') || /which|what|when|where|issue|experience|report|happen|date|time|resolution|refund|apology|investigation|member|contact|studio|request|category|reported|priority|freeze|roll|hosted|partner/i.test(line));

  if (questionLines.length < 2) {
    return null;
  }

  const fieldIds = new Set<string>();
  const add = (id: string, present?: string) => {
    if (!present) fieldIds.add(id);
  };

  for (const line of questionLines) {
    const lower = line.toLowerCase();
    if (lower.includes('studio')) add('studio', ctx.studio);
    if (/client|member|community member|affected|impact/.test(lower)) add('clientsAffected', ctx.clientsAffected);
    if (lower.includes('member') || lower.includes('name')) add('memberName', ctx.memberName);
    if (lower.includes('contact') || lower.includes('phone') || lower.includes('email')) add('memberContact', ctx.memberContact);
    if (lower.includes('issue') || lower.includes('experience') || lower.includes('report') || lower.includes('what happened') || lower.includes('what did')) add('description', ctx.description);
    if (lower.includes('when') || lower.includes('date') || lower.includes('time') || lower.includes('happen') || lower.includes('incident')) add('incidentDateTime', ctx.incidentDateTime);
    if (lower.includes('resolution') || lower.includes('looking for') || lower.includes('refund') || lower.includes('apology') || lower.includes('investigation') || lower.includes('something else')) add('desiredResolution', ctx.desiredResolution);
    if (lower.includes('specific') || lower.includes('type')) add('requestType', ctx.requestType);
    if (lower.includes('reported') || lower.includes('documented')) add('reportedBy', ctx.reportedBy);
    if (lower.includes('priority') || lower.includes('urgent')) add('priority', ctx.priority);
    if (lower.includes('freeze')) {
      add('membership', ctx.membership);
      add('freezeStartDate', ctx.freezeStartDate);
      add('freezeEndDate', ctx.freezeEndDate);
      add('freezeReason', ctx.freezeReason);
    }
    if (lower.includes('roll') || lower.includes('extension')) {
      add('membership', ctx.membership);
      add('classesRemaining', ctx.classesRemaining);
      add('packageExpiryDate', ctx.packageExpiryDate);
      add('requestedRolloverDate', ctx.requestedRolloverDate);
      add('rolloverReason', ctx.rolloverReason);
    }
    if (lower.includes('hosted') || lower.includes('partner') || lower.includes('influencer')) {
      add('partnerName', ctx.partnerName);
      add('hostedFeedbackArea', ctx.hostedFeedbackArea);
      add('prospectQuality', ctx.prospectQuality);
      add('followUpPreference', ctx.followUpPreference);
    }
  }

  return normalizeDetailForm({
    title: 'Complete the ticket details',
    description: 'Athena grouped the missing operational details into a structured intake form using the Physique 57 master data lists.',
    fields: Array.from(fieldIds),
    submitLabel: 'Continue drafting ticket',
  });
}

function mergeDraftWithContext(draft: DraftTicket, ctx: DetailContext): DraftTicket {
  const resolvedOwner = ctx.assignedTo || ctx.owner || draft.assignedTo || resolveTicketAssignee(ctx.category || draft.category, ctx.studio || draft.studio);
  const resolvedDepartment = ctx.department || ctx.team || draft.department || resolveTicketDepartment(ctx.category || draft.category, resolvedOwner);
  return {
    ...draft,
    category: ctx.category || draft.category,
    subCategory: ctx.subCategory || draft.subCategory,
    priority: (ctx.priority as DraftTicket['priority']) || draft.priority,
    studio: ctx.studio || draft.studio,
    trainer: draft.trainer || null,
    classType: draft.classType || null,
    classDateTime: draft.classDateTime || null,
    memberName: draft.memberName || null,
    memberContact: draft.memberContact || null,
    reportedBy: ctx.reportedBy || draft.reportedBy,
    assignedTo: resolvedOwner,
    department: resolvedDepartment,
    sentiment: ctx.memberSentiment || draft.sentiment,
    conversationSummary: ctx.description || draft.conversationSummary,
  };
}

function contextFromDraft(draft: DraftTicket, ctx: DetailContext): DetailContext {
  return {
    ...ctx,
    category: draft.category || ctx.category,
    subCategory: draft.subCategory || ctx.subCategory,
    priority: draft.priority || ctx.priority,
    studio: draft.studio || ctx.studio,
    trainer: draft.trainer || undefined,
    classType: draft.classType || undefined,
    classDateTime: draft.classDateTime || undefined,
    memberName: draft.memberName || undefined,
    memberContact: draft.memberContact || undefined,
    reportedBy: ctx.reportedBy || draft.reportedBy,
    assignedTo: draft.assignedTo || ctx.assignedTo || ctx.owner,
    department: draft.department || ctx.department || ctx.team,
    memberSentiment: draft.sentiment || ctx.memberSentiment,
    description: ctx.description || draft.description || draft.conversationSummary,
  };
}

function requiredFieldsForIssue(ctx: DetailContext, draft?: DraftTicket | null): string[] {
  const mergedContext: DetailContext = draft
    ? {
        ...ctx,
        category: ctx.category || draft.category,
        subCategory: ctx.subCategory || draft.subCategory,
        priority: ctx.priority || draft.priority,
        studio: ctx.studio || draft.studio,
        trainer: ctx.trainer || draft.trainer || undefined,
        classType: ctx.classType || draft.classType || undefined,
        classDateTime: ctx.classDateTime || draft.classDateTime || undefined,
        memberName: ctx.memberName || draft.memberName || undefined,
        memberContact: ctx.memberContact || draft.memberContact || undefined,
        reportedBy: ctx.reportedBy || draft.reportedBy || undefined,
        memberSentiment: ctx.memberSentiment || draft.sentiment || undefined,
        description: ctx.description || draft.description || draft.conversationSummary || undefined,
      }
    : ctx;
  if (draft) {
    const fields = getMissingIntakeFields(mergedContext, { includeClientImpact: true });
    return draft.description?.trim()
      ? fields.filter((field) => field !== 'description')
      : fields;
  }
  return getMissingIntakeFields(mergedContext);
}

const MEMBER_ENTITY_KEYS = ['memberId', 'memberName', 'memberContact', 'membership'] as const;
const SESSION_ENTITY_KEYS = ['sessionId', 'classType', 'classDateTime', 'trainer'] as const;

function hasConfirmedAffectedClients(value?: string): boolean {
  return /^yes\b/i.test(value || '');
}

function shouldCarryMemberContext(issueText: string, ctx: DetailContext): boolean {
  const value = [
    issueText,
    ctx.initialReport,
    ctx.category,
    ctx.subCategory,
    ctx.requestType,
    ctx.clientsAffected,
  ].filter(Boolean).join(' ').toLowerCase();

  if (hasConfirmedAffectedClients(ctx.clientsAffected)) return true;
  return /member|client|customer|guest|prospect|profile|contact|phone|email|membership|package|billing|payment|refund|freeze|roll\s?over|extension|renewal|follow-up/.test(value);
}

function shouldCarrySessionContext(issueText: string, ctx: DetailContext): boolean {
  const value = [
    issueText,
    ctx.initialReport,
    ctx.category,
    ctx.subCategory,
    ctx.requestType,
  ].filter(Boolean).join(' ').toLowerCase();

  return /class|session|booking|schedul|waitlist|attendance|attendee|trainer|instructor|barre|cycle|powercycle|strength|late cancellation|no-show/.test(value);
}

function pruneEntityContextForIssue(
  ctx: DetailContext,
  issueText: string,
  explicitlyRequestedFields = new Set<string>()
): DetailContext {
  const next: DetailContext = { ...ctx };
  const keepMemberContext = shouldCarryMemberContext(issueText, ctx)
    || MEMBER_ENTITY_KEYS.some((key) => explicitlyRequestedFields.has(key));
  const keepSessionContext = shouldCarrySessionContext(issueText, ctx)
    || SESSION_ENTITY_KEYS.some((key) => explicitlyRequestedFields.has(key));

  if (!keepMemberContext) {
    MEMBER_ENTITY_KEYS.forEach((key) => {
      delete (next as Record<string, unknown>)[key];
    });
  }

  if (!keepSessionContext) {
    SESSION_ENTITY_KEYS.forEach((key) => {
      delete (next as Record<string, unknown>)[key];
    });
  }

  return next;
}

function detailFormForContext(ctx: DetailContext): DetailForm | null {
  const fields = requiredFieldsForIssue(ctx);
  if (fields.length === 0) return null;
  return normalizeDetailForm({
    title: 'Complete the ticket details',
    description: 'Athena needs these required fields before a ticket draft can be reviewed.',
    fields,
    submitLabel: 'Continue drafting ticket',
  });
}

function detailFormForIncompleteDraft(draft: DraftTicket | null | undefined, ctx: DetailContext): DetailForm | null {
  if (!draft) return null;
  const fields = requiredFieldsForIssue(ctx, mergeDraftWithContext(draft, ctx));

  if (fields.length === 0) return null;
  return normalizeDetailForm({
    title: 'Complete the ticket details',
    description: 'Athena needs these required fields before the ticket can be published.',
    fields,
    submitLabel: 'Submit required details',
  });
}

function buildClientDraft(ctx: DetailContext, text: string): DraftTicket {
  const sourceText = ctx.initialReport || ctx.description || text;
  const normalizedContext = normalizeDraftContextForSource(ctx, sourceText) as DetailContext;
  const category = normalizedContext.category || 'General Feedback';
  const subCategory = normalizedContext.subCategory || 'Other';
  const includeMemberContext = shouldCarryMemberContext(sourceText, normalizedContext);
  const includeSessionContext = shouldCarrySessionContext(sourceText, normalizedContext);
  const description = buildOperationalTicketDescription({
    sourceText,
    context: normalizedContext,
    category,
    subCategory,
  });
  const summary = summarizeOperationalReport(sourceText);

  return {
    title: [normalizedContext.intakeRoute || 'Ticket', subCategory, normalizedContext.trainer || (includeMemberContext ? normalizedContext.memberName : null)].filter(Boolean).join(' · ').slice(0, 96),
    description,
    category,
    subCategory,
    priority: (normalizedContext.priority as DraftTicket['priority']) || 'Medium',
    studio: normalizedContext.studio || 'Unspecified Studio',
    trainer: includeSessionContext ? normalizedContext.trainer || null : null,
    classType: includeSessionContext ? normalizedContext.classType || null : null,
    classDateTime: includeSessionContext ? normalizedContext.classDateTime || null : null,
    memberName: includeMemberContext ? normalizedContext.memberName || null : null,
    memberContact: includeMemberContext ? normalizedContext.memberContact || null : null,
    reportedBy: normalizedContext.reportedBy || null,
    assignedTo: normalizedContext.assignedTo || normalizedContext.owner || null,
    department: normalizedContext.department || normalizedContext.team || null,
    tags: ['ai-draft', normalizedContext.intakeRoute, category, subCategory].filter(Boolean).map((value) =>
      String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    ),
    sentiment: normalizedContext.memberSentiment || 'Neutral',
    conversationSummary: summary,
  };
}

function normalizeDraftForReview(draft: DraftTicket, ctx: DetailContext, text: string): DraftTicket {
  const sourceText = ctx.initialReport || ctx.description || text || draft.conversationSummary || draft.description;
  const category = draft.category || ctx.category || 'General Feedback';
  const subCategory = draft.subCategory || ctx.subCategory || 'Other';
  const normalizedContext = normalizeDraftContextForSource({
    ...ctx,
    intakeRoute: ctx.intakeRoute,
    category,
    subCategory,
    studio: draft.studio || ctx.studio,
    trainer: draft.trainer || ctx.trainer,
    classType: draft.classType || ctx.classType,
    classDateTime: draft.classDateTime || ctx.classDateTime,
    memberName: draft.memberName || ctx.memberName,
    memberContact: draft.memberContact || ctx.memberContact,
    desiredResolution: ctx.desiredResolution,
  }, sourceText) as DetailContext;
  const includeMemberContext = shouldCarryMemberContext(sourceText, normalizedContext);
  const includeSessionContext = shouldCarrySessionContext(sourceText, normalizedContext);
  const description = draftDescriptionNeedsRewrite(draft.description, normalizedContext.intakeRoute, sourceText)
    ? buildOperationalTicketDescription({
        sourceText,
        context: normalizedContext,
        category,
        subCategory,
      })
    : draft.description;

  return {
    ...draft,
    title: draft.title || [normalizedContext.intakeRoute || 'Ticket', subCategory, normalizedContext.trainer || null].filter(Boolean).join(' · ').slice(0, 96),
    description,
    category,
    subCategory,
    studio: normalizedContext.studio || draft.studio || 'Unspecified Studio',
    trainer: includeSessionContext ? normalizedContext.trainer || draft.trainer || null : null,
    classType: includeSessionContext ? normalizedContext.classType || draft.classType || null : null,
    classDateTime: includeSessionContext ? normalizedContext.classDateTime || draft.classDateTime || null : null,
    memberName: includeMemberContext ? normalizedContext.memberName || draft.memberName || null : null,
    memberContact: includeMemberContext ? normalizedContext.memberContact || draft.memberContact || null : null,
    conversationSummary: summarizeOperationalReport(sourceText),
  };
}

function scorePercentFromEvaluation(input: TrainerEvaluationInput): number {
  const totalWeightage = input.scores.reduce((sum, item) => sum + item.weightage, 0);
  const totalScore = input.scores.reduce((sum, item) => sum + Math.max(0, Math.min(item.weightage, item.score)), 0);
  return totalWeightage ? Math.round((totalScore / totalWeightage) * 100) : 0;
}

function trainerEvaluationBand(scorePercent: number): string {
  if (scorePercent < 65) return 'High coaching priority';
  if (scorePercent < 80) return 'Development watch';
  return 'On-track performance';
}

function buildTrainerEvaluationDraft(input: TrainerEvaluationInput): DraftTicket {
  const scorePercent = scorePercentFromEvaluation(input);
  const structuredDescription = buildTrainerEvaluationText({ ...input, rawText: undefined });
  const trainerReview = buildTrainerReviewRecord(input, {
    source: 'athena',
    sourceRef: `athena-trainer-review:${input.trainer}:${input.template}:${input.reviewPeriod || Date.now()}`,
  });
  return {
    title: `Instructor evaluation · ${input.trainer} · ${input.template}`,
    description: structuredDescription,
    category: 'Trainer Feedback',
    subCategory: 'Knowledge and Competence',
    priority: 'Low',
    studio: input.studio || STUDIOS[0],
    trainer: input.trainer,
    classType: input.classType || null,
    classDateTime: input.reviewPeriod || null,
    memberName: null,
    memberContact: null,
    reportedBy: null,
    assignedTo: 'Trainer Profile',
    department: 'Training & Client Experience',
    tags: ['trainer-profile', 'instructor-evaluation', 'profile-only', input.template.toLowerCase()],
    sentiment: scorePercent >= 80 ? 'Positive' : scorePercent >= 65 ? 'Neutral' : 'Concern',
    conversationSummary: [
      `Instructor evaluation drafted for ${input.trainer} (${input.template}).`,
      `Weighted score: ${scorePercent}% · ${trainerEvaluationBand(scorePercent)}.`,
      input.focusPoints ? `Primary focus: ${input.focusPoints}` : '',
      input.goals ? `Target goal: ${input.goals}` : '',
      'Recorded under Trainer Profiles only. No operational owner or SLA follow-up required.',
    ].filter(Boolean).join('\n'),
    metadata: {
      profileOnly: true,
      trainerReview,
      routing: {
        department: 'Training & Client Experience',
        assigned_to: 'Trainer Profile',
        status: 'Closed',
        priority: 'Low',
        profile_only: true,
        routing_source: 'trainer_profile_record',
      },
    },
  };
}

export const ChatInterface: React.FC<{ onOpenExistingTicket?: (ticket: Ticket) => void; resetVersion?: number }> = ({ onOpenExistingTicket, resetVersion = 0 }) => {
  const { createApprovedTicket, tickets, setSelectedTicket } = useTickets();
  const { user } = useBackendAuth();
  const activeAiProvider = import.meta.env.VITE_AI_PROVIDER || 'openai';
  const athenaDebugTraceEnabled = isAthenaDebugTraceEnabled();
  const providerBadgeLabel = aiProviderBadgeLabel(activeAiProvider);
  const reporterName = getReporterName(user);
  const reporterFirstName = getReporterFirstName(reporterName);
  const [messages, setMessages] = useState<Message[]>(() => [buildGreetingMessage(reporterName)]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [context, setContext] = useState<DetailContext>({});
  const [pendingSingleField, setPendingSingleField] = useState<DetailFormField | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceLiveText, setVoiceLiveText] = useState('');
  const [voiceHint, setVoiceHint] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeDraftReviewMessageId, setActiveDraftReviewMessageId] = useState<string | null>(null);
  const [instructorEvaluationMode, setInstructorEvaluationMode] = useState(false);
  const [textToTicketOpen, setTextToTicketOpen] = useState(false);
  const [textToTicketText, setTextToTicketText] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<ContextTemplate | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'png' | null>(null);
  const [copyTranscriptState, setCopyTranscriptState] = useState<'idle' | 'copied'>('idle');
  const [loadDecorativeRobot, setLoadDecorativeRobot] = useState(false);
  const publishingRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalVoiceTranscriptRef = useRef('');
  const voiceSessionActiveRef = useRef(false);
  const voiceManualStopRef = useRef(false);
  const voiceSilenceTimerRef = useRef<number | null>(null);
  const requestNonceRef = useRef(0);
  const activeChatEpochRef = useRef(0);
  const shownRelatedTicketNoticeKeysRef = useRef<Set<string>>(new Set());
  const lastResetVersionRef = useRef(resetVersion);
  const lastSentContextRef = useRef<DetailContext>({});
  const recentTickets = useMemo(
    () => tickets
      .filter((ticket) => !isTrainerEvaluationProfileOnly(ticket))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 2),
    [tickets]
  );
  const smartVoiceHints = useMemo(() => {
    const source = voiceLiveText || input;
    return source.trim() ? buildVoiceExtractionHints(source) : [];
  }, [input, voiceLiveText]);
  const isUrgentInput = useMemo(() => {
    if (input.length < 6) return false;
    return /\b(injur|injury|unsafe|harass|harassment|theft|fire|blood|emergency|accident|fracture|fell|ambulance|angry|furious|irate|refund|cancel(?:l?ation)?|lawsuit|legal|escalat|abuse|assault)\b/i.test(input);
  }, [input]);
  const capturedContextSummary = useMemo(() => {
    const items: string[] = [];
    if (context.studio) items.push(`📍 ${context.studio.split(',')[0]}`);
    if (context.category) items.push(`🏷 ${context.category}`);
    if (context.subCategory) items.push(`• ${context.subCategory}`);
    if (context.memberName) items.push(`👤 ${context.memberName}`);
    if (context.priority) items.push(`⚡ ${context.priority}`);
    if (context.classType) items.push(`🏋️ ${context.classType}`);
    return items;
  }, [context]);
  const activeDraftReviewMessage = useMemo(
    () => messages.find((message) => message.id === activeDraftReviewMessageId && message.ticket) || null,
    [activeDraftReviewMessageId, messages]
  );

  const addExportError = useCallback((format: string, error: unknown) => {
    const message = getDisplayError(error, `Could not export ${format}`);
    setMessages((prev) => [
      ...prev,
      {
        id: `export-error-${Date.now()}`,
        role: 'assistant',
        content: `I could not export the conversation as ${format}: ${message}`,
      },
    ]);
  }, []);

  const exportTranscriptText = useCallback(() => {
    try {
      const exportedAt = new Date();
      downloadTextFile(
        `${transcriptFileBaseName(exportedAt)}.txt`,
        plainTextForChatTranscript(messages, { conversationId, reporterName, exportedAt }),
        'text/plain;charset=utf-8'
      );
    } catch (error) {
      addExportError('text', error);
    }
  }, [addExportError, conversationId, messages, reporterName]);

  const exportTranscriptHtml = useCallback(() => {
    try {
      const exportedAt = new Date();
      downloadTextFile(
        `${transcriptFileBaseName(exportedAt)}.html`,
        htmlForChatTranscript(messages, { conversationId, reporterName, exportedAt }),
        'text/html;charset=utf-8'
      );
    } catch (error) {
      addExportError('HTML', error);
    }
  }, [addExportError, conversationId, messages, reporterName]);

  const copyTranscript = useCallback(async () => {
    try {
      const exportedAt = new Date();
      const text = plainTextForChatTranscript(messages, { conversationId, reporterName, exportedAt });
      await navigator.clipboard.writeText(text);
      setCopyTranscriptState('copied');
      window.setTimeout(() => setCopyTranscriptState('idle'), 2000);
    } catch (error) {
      addExportError('clipboard', error);
    }
  }, [addExportError, conversationId, messages, reporterName]);

  const exportTranscriptPng = useCallback(async () => {
    const node = scrollRef.current;
    if (!node) return;
    setExportingFormat('png');
    try {
      const exportedAt = new Date();
      const dataUrl = await pngDataUrlForElementScreenshot(node);
      downloadDataUrl(`${transcriptFileBaseName(exportedAt)}.png`, dataUrl);
    } catch (error) {
      addExportError('PNG', error);
    } finally {
      setExportingFormat(null);
    }
  }, [addExportError]);

  useEffect(() => {
    setContext((current) => {
      if (current.reportedBy === reporterName) return current;
      return { ...current, reportedBy: reporterName };
    });
  }, [reporterName]);

  useEffect(() => {
    setMessages((current) => {
      if (current.length !== 1 || current[0].id !== 'greet') return current;
      return [buildGreetingMessage(reporterName)];
    });
  }, [reporterName]);

  useEffect(() => {
    const mode = instructorEvaluationMode ? 'trainer' : 'ticket';
    document.documentElement.dataset.athenaMode = mode;
    window.dispatchEvent(new CustomEvent('athena-mode-change', { detail: { mode } }));
    return () => {
      document.documentElement.dataset.athenaMode = 'ticket';
      window.dispatchEvent(new CustomEvent('athena-mode-change', { detail: { mode: 'ticket' } }));
    };
  }, [instructorEvaluationMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    const idle = window.requestIdleCallback?.(() => setLoadDecorativeRobot(true), { timeout: 2_500 });
    if (idle != null) return () => window.cancelIdleCallback?.(idle);
    const handle = window.setTimeout(() => setLoadDecorativeRobot(true), 1_500);
    return () => window.clearTimeout(handle);
  }, []);

  // Prefetch both session caches on mount: hosted (private) and all-sessions ([]).
  // Dropdowns read from momenceSessionSearchCache and skip their own fetch when warm.
  useEffect(() => {
    const prefetch = (types: string[]) => {
      const cacheKey = momenceSessionDropdownCacheKey(types);
      if (momenceSessionSearchCache.has(cacheKey)) return;
      loadMomenceSessionsProgressively('', { types }, (sessions) => {
        const existing = momenceSessionSearchCache.get(cacheKey) ?? [];
        momenceSessionSearchCache.set(cacheKey, mergeMomenceSessionOptions(existing, sessions));
      }).then((sessions) => {
        momenceSessionSearchCache.set(cacheKey, sessions);
      }).catch(() => {});
    };
    prefetch(HOSTED_CLASS_SESSION_TYPES);
    prefetch([]);
  }, []);

  useEffect(() => {
    const maybeCtor = (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition
      || (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    setVoiceSupported(Boolean(maybeCtor));
  }, []);

  useEffect(() => () => {
    voiceSessionActiveRef.current = false;
    speechRecognitionRef.current?.stop();
    if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current);
  }, []);

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingAttachments((current) => {
      const next = [...current];
      Array.from(files).forEach((file) => {
        const exists = next.some((entry) => (
          entry.file.name === file.name &&
          entry.file.size === file.size &&
          entry.file.lastModified === file.lastModified
        ));
        if (!exists) next.push({ id: `${file.name}-${file.size}-${file.lastModified}`, file });
      });
      return next.slice(0, 8);
    });
  };

  const normalizeVoiceText = (value: string) =>
    value
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .trim();

  const armVoiceSilenceTimer = () => {
    if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current);
    voiceSilenceTimerRef.current = window.setTimeout(() => {
      if (voiceSessionActiveRef.current && speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
    }, 2500);
  };

  const startVoiceCapture = () => {
    if (loading || listening) return;
    const maybeCtor = (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition
      || (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!maybeCtor) return;

    finalVoiceTranscriptRef.current = '';
    voiceManualStopRef.current = false;
    voiceSessionActiveRef.current = true;
    setVoiceLiveText('');
    setVoiceHint('Listening… speak naturally.');
    const recognition = new maybeCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 3;
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const fragment = event.results[i][0]?.transcript || '';
        const cleanedFragment = normalizeVoiceText(fragment);
        if (!cleanedFragment || cleanedFragment.length < 2) continue;
        if (event.results[i].isFinal) {
          finalVoiceTranscriptRef.current = normalizeVoiceText(`${finalVoiceTranscriptRef.current} ${cleanedFragment}`);
        } else {
          interim += ` ${cleanedFragment}`;
        }
      }
      const composed = normalizeVoiceText(`${finalVoiceTranscriptRef.current} ${interim}`);
      setVoiceLiveText(composed);
      setInput(composed);
      armVoiceSilenceTimer();
    };
    recognition.onerror = (event) => {
      const reason = event?.error ? `Microphone issue: ${event.error}` : 'Microphone issue detected.';
      setVoiceHint(reason);
      setListening(false);
      voiceSessionActiveRef.current = false;
      speechRecognitionRef.current = null;
      if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current);
    };
    recognition.onend = () => {
      if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current);
      const finalTranscript = normalizeVoiceText(finalVoiceTranscriptRef.current);
      if (voiceSessionActiveRef.current && !voiceManualStopRef.current) {
        try {
          recognition.start();
          setVoiceHint('Listening…');
          return;
        } catch {
          // fall through to finalize
        }
      }
      setListening(false);
      voiceSessionActiveRef.current = false;
      speechRecognitionRef.current = null;
      setVoiceLiveText('');
      setVoiceHint('');
      if (finalTranscript && !loading) {
        sendMessage(finalTranscript);
      }
    };
    speechRecognitionRef.current = recognition;
    setListening(true);
    armVoiceSilenceTimer();
    recognition.start();
  };

  const stopVoiceCapture = () => {
    voiceManualStopRef.current = true;
    voiceSessionActiveRef.current = false;
    if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current);
    setVoiceHint('Finalizing transcript…');
    speechRecognitionRef.current?.stop();
  };

  const buildContextPreamble = (ctx: DetailContext) => {
    const parts: string[] = [];

    // --- Core identity fields ---
    if (ctx.memberName) parts.push(`Member: ${ctx.memberName}`);
    if (ctx.memberId) parts.push(`Momence ID: ${ctx.memberId}`);
    if (ctx.memberContact) parts.push(`Contact: ${ctx.memberContact}`);
    if (ctx.membership) parts.push(`Membership: ${ctx.membership}`);

    // --- Ticket routing ---
    if (ctx.intakeRoute) parts.push(`Route: ${ctx.intakeRoute}`);
    if (ctx.requestType) parts.push(`Type: ${ctx.requestType}`);
    if (ctx.category) parts.push(`Category: ${ctx.category}`);
    if (ctx.subCategory) parts.push(`Sub-category: ${ctx.subCategory}`);
    if (ctx.priority) parts.push(`Priority: ${ctx.priority}`);
    if (ctx.clientsAffected) parts.push(`Clients affected: ${ctx.clientsAffected}`);
    if (ctx.reportedBy) parts.push(`Reported by: ${ctx.reportedBy}`);

    // --- Session & location context ---
    if (ctx.studio) parts.push(`Studio: ${ctx.studio}`);
    if (ctx.classType) parts.push(`Class: ${ctx.classType}`);
    if (ctx.trainer) parts.push(`Trainer: ${ctx.trainer}`);
    if (ctx.classDateTime) parts.push(`Session date/time: ${ctx.classDateTime}`);
    if (ctx.sessionId) parts.push(`Momence session ID: ${ctx.sessionId}`);

    // --- Issue substance ---
    if (ctx.description) parts.push(`Issue: ${ctx.description}`);
    if (ctx.incidentDateTime) parts.push(`Incident at: ${ctx.incidentDateTime}`);
    if (ctx.memberSentiment) parts.push(`Sentiment: ${ctx.memberSentiment}`);
    if (ctx.urgencyReason) parts.push(`Urgency: ${ctx.urgencyReason}`);
    if (ctx.desiredResolution) parts.push(`Resolution requested: ${ctx.desiredResolution}`);

    // --- Remaining custom fields (catch-all) ---
    const HANDLED_KEYS = new Set([
      'memberName', 'memberId', 'memberContact', 'membership',
      'intakeRoute', 'requestType', 'category', 'subCategory', 'priority', 'clientsAffected', 'reportedBy',
      'studio', 'classType', 'trainer', 'classDateTime', 'sessionId',
      'description', 'incidentDateTime', 'memberSentiment', 'urgencyReason', 'desiredResolution',
      'conversationPlan', 'reporterFirstName', 'initialReport',
    ]);
    Object.entries(ctx).forEach(([key, value]) => {
      if (value && !HANDLED_KEYS.has(key)) {
        parts.push(`${getDetailField(key)?.label || key}: ${value}`);
      }
    });

    // --- Constant hints so AI picks valid values ---
    const hints: string[] = [];
    if (!ctx.studio) hints.push(`Valid studios: ${STUDIOS.join(', ')}`);
    if (!ctx.classType) hints.push(`Valid class types: ${CLASS_TYPES.join(', ')}`);
    if (!ctx.trainer) hints.push(`Valid trainers: ${TRAINERS.join(', ')}`);


    const contextBlock = parts.length ? `[Context — ${parts.join(' | ')}]` : '';
    const hintsBlock = hints.length ? `[Constants — ${hints.join(' | ')}]` : '';
    return [contextBlock, hintsBlock].filter(Boolean).join('\n') + (contextBlock || hintsBlock ? '\n' : '');
  };

  const buildDeltaContextPreamble = (current: DetailContext, previous: DetailContext): string => {
    const changed: DetailContext = {};
    for (const key of Object.keys(current) as (keyof DetailContext)[]) {
      if (current[key] && current[key] !== previous[key]) {
        (changed as Record<string, unknown>)[key] = current[key];
      }
    }
    if (Object.keys(changed).length === 0) return '';
    return buildContextPreamble(changed);
  };

  const sendMessage = async (text: string, contextOverride?: DetailContext) => {
    if (!text.trim() || loading) return;
    if (!contextOverride && !pendingSingleField && isCasualGreeting(text)) {
      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
      };
      setInput('');
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      await sleep(520);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          aiGenerated: true,
          content: reporterFirstName
            ? `Hi ${reporterFirstName}, I’m ready. What are we logging? 🙂`
            : "Hi, I’m ready. What are we logging? 🙂",
          suggestedChips: getGreetingQuickActions(),
        },
      ]);
      setLoading(false);
      return;
    }
    let activeContext: DetailContext = { ...(contextOverride || context), reportedBy: reporterName };
    if (!contextOverride && pendingSingleField && pendingSingleField.type !== 'select') {
      activeContext = applyDetailValue(context, pendingSingleField.id, text.trim());
      activeContext.reportedBy = reporterName;
      setContext(activeContext);
      setPendingSingleField(null);
    }
    const capturedFeedback = !contextOverride && !pendingSingleField
      ? captureMemberFeedbackFromText(text, activeContext)
      : null;

    if (capturedFeedback) {
      activeContext = applyDetailValue(activeContext, 'description', capturedFeedback);
      activeContext.reportedBy = reporterName;
      setContext(activeContext);
    }
    const issueText = capturedFeedback || text;
    if (!activeContext.initialReport && !/^here are the missing details:/i.test(text.trim())) {
      activeContext = { ...activeContext, initialReport: issueText };
    }
    if (reporterFirstName) {
      activeContext = { ...activeContext, reporterFirstName };
    }
    activeContext.reportedBy = reporterName;
    activeContext.reportedBy = reporterName;
    setContext(activeContext);
    const isFirstTurn = messages.filter((m) => m.role === 'user').length === 0;
    const preamble = isFirstTurn
      ? buildContextPreamble(activeContext)
      : buildDeltaContextPreamble(activeContext, lastSentContextRef.current);
    lastSentContextRef.current = { ...activeContext };
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');

    const requestNonce = ++requestNonceRef.current;
    const requestEpoch = activeChatEpochRef.current;
    try {
      setLoading(true);
      const relatedTickets = findRelatedSubmittedTickets(capturedFeedback || text, activeContext, tickets.filter((ticket) => !isTrainerEvaluationProfileOnly(ticket)));
      const relatedTicketNotice = buildRelatedTicketNotice(relatedTickets, shownRelatedTicketNoticeKeysRef.current);
      if (relatedTicketNotice) {
        shownRelatedTicketNoticeKeysRef.current.add(relatedTicketNotice.key);
        setMessages((prev) => [
          ...prev,
          {
            id: `${relatedTicketNotice.messageIdPrefix}-${Date.now()}`,
            role: 'assistant',
            content: relatedTicketNotice.content,
          },
        ]);
      }

      const { data, error } = await withTimeout(
        invokeTicketingFunction<AiIntakeResponse>('ticket-ai-chat', {
          body: buildAthenaDraftRequestBody({
            aiProvider: activeAiProvider,
            debugTrace: athenaDebugTraceEnabled,
            messages: newMessages,
            preamble,
            conversationId,
            context: activeContext,
          }),
        }),
        ATHENA_CHAT_RESPONSE_TIMEOUT_MS,
        ATHENA_CHAT_TIMEOUT_MESSAGE
      );

      if (error) throw error;
      if (requestEpoch !== activeChatEpochRef.current || requestNonce !== requestNonceRef.current) return;

      if (data?.conversationId && !conversationId) {
        setConversationId(data.conversationId);
      }

      const inferredContext = normalizeInferredContext(data?.inferredContext);
      let responseContext = mergeInferredContext(activeContext, inferredContext, data?.urgencyReason);
      // Always sync context after every AI response — not just when inferredContext has keys.
      // This ensures entity fields (studio, trainer, etc.) the AI inferred are persisted for the next turn.
      responseContext = { ...responseContext, reportedBy: reporterName };
      activeContext = responseContext;
      setContext(responseContext);

      const normalizedAiTicket = data?.ticket ? normalizeDraftForReview(data.ticket, responseContext, text) : null;
      const remainingMissingFields: string[] = [];
      const requiredFieldSet = new Set(remainingMissingFields);
      const deterministicForm = null;
      const acceptsAiDetailForm = shouldAcceptAiDetailForm({
        remainingMissingFieldCount: remainingMissingFields.length,
        aiNeedsMoreInfo: data?.needsMoreInfo,
        aiProposedFieldCount: data?.detailForm?.fields?.length ?? 0,
      });
      const normalizedForm = acceptsAiDetailForm
        ? pruneDetailForm(
            filterAiDetailForm(normalizeDetailForm(data?.detailForm, responseContext), responseContext, requiredFieldSet),
            responseContext
          )
        : null;
      const detailForm = mergeDetailForms(deterministicForm, normalizedForm);
      const finalDetailForm = batchDetailFormForConversation(detailForm);
      const holdDraftForMoreInfo = shouldHoldDraftForMoreInfo({
        hasDetailForm: Boolean(finalDetailForm),
        remainingMissingFieldCount: remainingMissingFields.length,
        aiNeedsMoreInfo: data?.needsMoreInfo,
      });
      let ticket = holdDraftForMoreInfo
        ? null
        : normalizedAiTicket || buildClientDraft(responseContext, text);
      if (
        ticket &&
        responseContext.category === 'Hosted Class & Partnerships' &&
        (ticket.category === 'General Feedback' || ticket.subCategory === 'Other')
      ) {
        ticket = {
          ...ticket,
          category: 'Hosted Class & Partnerships',
          subCategory: responseContext.subCategory || 'Hosted Class Feedback',
          tags: Array.from(new Set([...(ticket.tags || []), 'hosted-class', 'partnership-feedback'])),
        };
      }
      if (ticket) {
        const syncedContext = contextFromDraft(ticket, responseContext);
        activeContext = { ...syncedContext, reportedBy: reporterName };
        setContext(activeContext);
      }
      const singleField = finalDetailForm?.fields.length === 1 ? finalDetailForm.fields[0] : null;
      const singleFieldNeedsPicker = singleField
        ? (['memberName', 'memberContact', 'classType', 'sessionId', 'membership'].includes(singleField.id) ||
            singleField.type === 'date' ||
            singleField.type === 'datetime-local')
        : false;
      const singleFieldChips = singleField && !singleFieldNeedsPicker && singleField.type === 'select'
        ? chipsForSingleField(singleField, responseContext)
        : [];
      const renderSingleFieldAsChat = Boolean(
        singleField &&
        !singleFieldNeedsPicker &&
        singleField.type === 'select' &&
        singleFieldChips.length > 0
      );
      const assistantContent = singleField
        ? (data?.reply || buildNaturalSingleFieldPrompt({
            field: singleField,
            reporterFirstName,
          }))
        : finalDetailForm
          ? (data?.reply || `${reporterFirstName ? `${reporterFirstName}, ` : ''}Just a couple more details and we'll have a clean draft ready! 🙂`)
          : ticket
            ? (data?.reply || "Looks good — I've drafted the ticket below. Take a quick look before publishing.")
            : data?.reply || "Hmm, I didn't quite catch that. Could you tell me a bit more?";
      setPendingSingleField(null);
      await sleep(writingPauseMs(assistantContent));
      if (requestEpoch !== activeChatEpochRef.current || requestNonce !== requestNonceRef.current) return;
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        aiGenerated: true,
        content: assistantContent,
        ticket,
        suggestedChips: singleFieldChips,
        detailForm: renderSingleFieldAsChat ? null : finalDetailForm,
        published: false,
        ticketId: undefined,
      };
      setMessages((prev) => [
        ...prev,
        assistantMsg,
      ]);
      if (ticket) {
        setActiveDraftReviewMessageId(assistantMsg.id);
      }

    } catch (e: unknown) {
      if (requestEpoch !== activeChatEpochRef.current || requestNonce !== requestNonceRef.current) return;
      const message = getDisplayError(e, 'Ticket AI chat failed');
      if (message.includes(ATHENA_CHAT_TIMEOUT_MESSAGE)) {
        const timeoutForm = null;
        const singleField = timeoutForm?.fields.length === 1 ? timeoutForm.fields[0] : null;
        const singleFieldNeedsPicker = singleField
          ? (['memberName', 'memberContact', 'classType', 'sessionId', 'membership'].includes(singleField.id) ||
              singleField.type === 'date' ||
              singleField.type === 'datetime-local')
          : false;
        const singleFieldChips = singleField && !singleFieldNeedsPicker && singleField.type === 'select'
          ? chipsForSingleField(singleField, activeContext)
          : [];
        const renderSingleFieldAsChat = Boolean(
          singleField &&
          !singleFieldNeedsPicker &&
          singleField.type === 'select' &&
          singleFieldChips.length > 0
        );
        const fallbackTicket = timeoutForm ? null : buildClientDraft(activeContext, text);
        const fallbackContent = singleField
          ? buildNaturalSingleFieldPrompt({ field: singleField, reporterFirstName })
          : timeoutForm
            ? `${reporterFirstName ? `${reporterFirstName}, ` : ''}I’m taking a little longer than usual — continuing locally so you don’t lose momentum.`
            : 'I’m taking a little longer than usual, so I’ve prepared a local draft for you to review.';

        setPendingSingleField(null);
        const fallbackMessage: Message = {
          id: `timeout-${Date.now()}`,
          role: 'assistant',
          aiGenerated: false,
          content: fallbackContent,
          ticket: fallbackTicket,
          suggestedChips: singleFieldChips,
          detailForm: renderSingleFieldAsChat ? null : timeoutForm,
          published: false,
        };
        setMessages((prev) => [...prev, fallbackMessage]);
        if (fallbackTicket) setActiveDraftReviewMessageId(fallbackMessage.id);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: `Something went wrong on my end — ${message}. Feel free to try again!`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleChipClick = (chip: SuggestedChip) => {
    if (context[chip.field]) return;
    const next = applyDetailValue(context, chip.field, chip.value);
    setPendingSingleField(null);
    setContext(next);
    sendMessage(`${getDetailField(chip.field)?.label || chip.field}: ${chip.value}`, next);
  };

  const applyTemplate = (template: ContextTemplate) => {
    setPendingSingleField(null);
    setActiveTemplate(template);
    setContext((current) => ({
      ...current,
      intakeRoute: template.intakeRoute,
      category: template.category,
      subCategory: template.subCategory,
      priority: template.priority,
      reportedBy: reporterName,
    }));
  };

  const resetChat = useCallback(() => {
    activeChatEpochRef.current += 1;
    requestNonceRef.current += 1;
    voiceSessionActiveRef.current = false;
    voiceManualStopRef.current = true;
    speechRecognitionRef.current?.stop();
    if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current);
    setListening(false);
    setVoiceLiveText('');
    setVoiceHint('');
    setMessages([buildGreetingMessage(reporterName)]);
    setContext({ reportedBy: reporterName });
    setPendingSingleField(null);
    setPendingAttachments([]);
    setConversationId(null);
    setActiveDraftReviewMessageId(null);
    shownRelatedTicketNoticeKeysRef.current.clear();
    setInstructorEvaluationMode(false);
    setActiveTemplate(null);
    setLoading(false);
  }, [reporterName]);

  useEffect(() => {
    if (resetVersion === lastResetVersionRef.current) return;
    lastResetVersionRef.current = resetVersion;
    resetChat();
  }, [resetVersion, resetChat]);

  const submitDetailForm = (values: Record<string, string>, form?: DetailForm) => {
    const formFieldIds = new Set((form?.fields || []).map((field) => String(field.id)));
    const formIncludesMember = ['memberId', 'memberName', 'memberContact', 'membership']
      .some((field) => formFieldIds.has(field));
    const formIncludesSession = ['sessionId', 'classType', 'classDateTime', 'trainer']
      .some((field) => formFieldIds.has(field));
    const allowedValueKeys = new Set(formFieldIds);
    if (formIncludesMember) MEMBER_ENTITY_KEYS.forEach((field) => allowedValueKeys.add(field));
    if (formIncludesSession) {
      SESSION_ENTITY_KEYS.forEach((field) => allowedValueKeys.add(field));
      allowedValueKeys.add('studio');
    }

    let nextContext: DetailContext = { ...context, reportedBy: reporterName };
    for (const [key, value] of Object.entries(values)) {
      if (form && !allowedValueKeys.has(key)) continue;
      if (!value) continue;
      nextContext = applyDetailValue(nextContext, key, value);
    }

    const fieldLabels = new Map((form?.fields || []).map((field) => [field.id, field.label]));
    const detailLines = Object.entries(values)
      .filter(([key, value]) => (!form || allowedValueKeys.has(key)) && value.trim())
      .map(([key, value]) => `${getDetailField(key)?.label || fieldLabels.get(key) || key}: ${value}`);
    nextContext.reportedBy = reporterName;
    setContext(nextContext);
    setPendingSingleField(null);
    sendMessage(`Here are the missing details:\n${detailLines.join('\n')}`, nextContext);
  };

  const publishDraft = async (messageId: string, draft: DraftTicket, trainerEvaluation?: TrainerEvaluationInput) => {
    if (loading || publishingRef.current.has(messageId)) return;
    const publishableDraft = mergeDraftWithContext(draft, context);
    const publishContext = contextFromDraft(publishableDraft, context);
    publishingRef.current.add(messageId);
    setLoading(true);
    try {
      const created = await createApprovedTicket(
        publishableDraft,
        conversationId,
        publishContext as Record<string, unknown>,
        pendingAttachments.map((entry) => entry.file)
      );
      if (trainerEvaluation && !publishableDraft.metadata?.trainerReview) {
        saveTrainerReview(trainerEvaluation);
      }
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? { ...message, published: true, ticketId: created.id, publishedTicket: created }
            : message
        )
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `published-${Date.now()}`,
          role: 'assistant',
          content: `Done. Ticket **${created.id}** has been published to Submitted Tickets. ✅`,
          published: true,
          ticketId: created.id,
          publishedTicket: created,
        },
      ]);
      setPendingAttachments([]);
      setActiveDraftReviewMessageId(null);
    } catch (e: unknown) {
      const message = getDisplayError(e, 'Ticket creation failed');
      setMessages((prev) => [
        ...prev,
        {
          id: `publish-error-${Date.now()}`,
          role: 'assistant',
          content: `I could not publish that ticket yet: ${message}. The draft is still available for approval.`,
        },
      ]);
    } finally {
      publishingRef.current.delete(messageId);
      setLoading(false);
    }
  };

  const refineDraft = () => {
    // TicketPreviewCard owns the edit UI; this callback keeps the existing prop contract.
  };

  const saveEditedDraft = (messageId: string, draft: DraftTicket) => {
    const syncedContext = { ...contextFromDraft(draft, context), reportedBy: reporterName };
    setContext(syncedContext);
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              ticket: {
                ...draft,
                conversationSummary: draft.conversationSummary || draft.description,
              },
              published: false,
              ticketId: undefined,
            }
          : message
      )
    );
  };

  const discardDraft = (messageId: string) => {
    setActiveDraftReviewMessageId((current) => current === messageId ? null : current);
    setMessages((prev) =>
      prev.map((message) => (
        message.id === messageId
          ? { ...message, ticket: null, detailForm: null, published: false, ticketId: undefined, content: 'Draft discarded.' }
          : message
      ))
    );
  };

  const onConfirmDraftFromMessage = (message: Message) => {
    if (!message.ticket) return;
    publishDraft(message.id, mergeDraftWithContext(message.ticket, context), message.trainerEvaluation);
  };

  const createTrainerEvaluationDraft = (evaluation: TrainerEvaluationInput, source: 'form' | 'text' = 'form') => {
    const draft = buildTrainerEvaluationDraft(evaluation);
    const messageId = `trainer-eval-draft-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        role: 'assistant',
        aiGenerated: true,
        content: source === 'text'
          ? `I extracted the pasted review into a structured instructor evaluation draft for **${evaluation.trainer}**. Please review before publishing.`
          : `Instructor evaluation draft prepared for **${evaluation.trainer}**. Please review before publishing.`,
        ticket: draft,
        trainerEvaluation: evaluation,
        published: false,
      },
    ]);
    setContext((current) => ({
      ...current,
      studio: evaluation.studio || current.studio,
      trainer: evaluation.trainer || current.trainer,
      classType: evaluation.classType || current.classType,
      category: 'Trainer Feedback',
      subCategory: 'Knowledge and Competence',
      reportedBy: reporterName,
    }));
    setActiveDraftReviewMessageId(messageId);
  };

  const submitInstructorEvaluation = async (evaluation: TrainerEvaluationInput) => {
    createTrainerEvaluationDraft(evaluation, 'form');
    setInstructorEvaluationMode(false);
  };

  const submitTextToTicket = async () => {
    const sourceText = textToTicketText.trim();
    if (!sourceText) return;
    setLoading(true);
    try {
      const aiInstruction = [
        'TEXT_TO_TICKET_CLASSIFICATION_TASK',
        'Classify the pasted text as either trainer_evaluation or ticket_submission.',
        'If it is trainer_evaluation, return a Trainer Feedback draft only; do not treat it as a member complaint.',
        'If it is ticket_submission, return the normal support ticket draft.',
        'Use structured fields instead of placing all pasted text into description.',
        '',
        sourceText,
      ].join('\n');
      const { data } = await invokeTicketingFunction<AiIntakeResponse>('ticket-ai-chat', {
        body: buildAthenaDraftRequestBody({
          aiProvider: activeAiProvider,
          debugTrace: athenaDebugTraceEnabled,
          messages: [{ id: `text-to-ticket-${Date.now()}`, role: 'user', content: aiInstruction }],
          preamble: buildContextPreamble({ ...context, reportedBy: reporterName }),
          conversationId,
          context: {
            ...context,
            reportedBy: reporterName,
            textToTicketMode: true,
            classificationOptions: ['trainer_evaluation', 'ticket_submission'],
          },
        }),
      });

      const aiTicket = data?.ticket || null;
      const aiSaysTrainer = aiTicket?.category === 'Trainer Feedback' ||
        /trainer[_\s-]?evaluation|instructor evaluation|performance review|weighted scoring|focus points/i.test(`${data?.reply || ''}\n${aiTicket?.title || ''}\n${aiTicket?.description || ''}`);
      const localTrainerSignal = /client feedback|internal feedback|focus points|avg attendance|conversion rate|certification|trainer|instructor|barre classes|power\s?cycle/i.test(sourceText);

      if (aiSaysTrainer || (!aiTicket && localTrainerSignal)) {
        const evaluation = parseTrainerEvaluationText(sourceText, context.trainer || 'Unspecified Instructor');
        createTrainerEvaluationDraft({
          ...evaluation,
          studio: context.studio || evaluation.studio,
          classType: context.classType || evaluation.classType,
          reviewPeriod: context.classDateTime || evaluation.reviewPeriod,
        }, 'text');
      } else {
        const inferredContext = normalizeInferredContext(data?.inferredContext);
        const draftContext = mergeInferredContext({ ...context, reportedBy: reporterName }, inferredContext);
        const draft = aiTicket
          ? normalizeDraftForReview(aiTicket, draftContext, sourceText)
          : buildClientDraft(draftContext, sourceText);
        const messageId = `text-ticket-draft-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            role: 'assistant',
            aiGenerated: true,
            content: 'I classified the pasted text as a support ticket and prepared a draft for review.',
            ticket: draft,
            published: false,
          },
        ]);
        setActiveDraftReviewMessageId(messageId);
      }
      setTextToTicketText('');
      setTextToTicketOpen(false);
    } catch (error) {
      const localTrainerSignal = /client feedback|internal feedback|focus points|avg attendance|conversion rate|certification|trainer|instructor|barre classes|power\s?cycle/i.test(sourceText);
      if (localTrainerSignal) {
        const evaluation = parseTrainerEvaluationText(sourceText, context.trainer || 'Unspecified Instructor');
        createTrainerEvaluationDraft({
          ...evaluation,
          studio: context.studio || evaluation.studio,
          classType: context.classType || evaluation.classType,
          reviewPeriod: context.classDateTime || evaluation.reviewPeriod,
        }, 'text');
      } else {
        const messageId = `text-ticket-draft-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            role: 'assistant',
            aiGenerated: true,
            content: 'AI classification was unavailable, so I prepared a support-ticket draft using the pasted text.',
            ticket: buildClientDraft({ ...context, reportedBy: reporterName }, sourceText),
            published: false,
          },
        ]);
        setActiveDraftReviewMessageId(messageId);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-200/60 font-['Plus_Jakarta_Sans',Inter,sans-serif]">
      <div className="relative hidden h-full w-[32%] shrink-0 overflow-hidden border-r border-slate-200 bg-gradient-to-br from-slate-100 via-white to-blue-50 lg:block 2xl:w-[26%]">
        <div className="absolute -left-12 top-16 h-56 w-56 rounded-full bg-blue-400/20 blur-3xl" />
        <div className="absolute -right-12 bottom-10 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(100,116,139,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(100,116,139,0.08)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_78%_56%_at_50%_50%,#000_68%,transparent_110%)]" />
        {loadDecorativeRobot ? (
          <InteractiveRobotSpline
            key={instructorEvaluationMode ? 'athena-trainer-blue' : 'athena-ticket-blue'}
            scene={ROBOT_SPLINE_URL}
            className="athena-bot-tint-blue absolute inset-0 h-full w-full transition duration-500"
            smile
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-70">
            <img src="/download-1.png" alt="Athena" className="-scale-x-100 h-56 w-56 rounded-[2rem] object-contain blur-[0.2px]" />
          </div>
        )}
        <div className="absolute left-3 right-3 top-3 z-10">
          <div className="flex items-center justify-between rounded-2xl border border-white/50 bg-white/40 px-3 py-2 shadow-[0_18px_54px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Athena mode</div>
              <div className="truncate text-xs font-semibold text-blue-950">
                {instructorEvaluationMode ? 'Instructor evaluation' : 'Ticket intake'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={instructorEvaluationMode}
              onClick={() => setInstructorEvaluationMode((current) => !current)}
              className={`relative h-7 w-12 rounded-full border transition ${
                instructorEvaluationMode
                  ? 'border-blue-500 bg-blue-600'
                  : 'border-blue-200 bg-blue-100'
              }`}
              title="Toggle instructor evaluation mode"
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition ${
                  instructorEvaluationMode ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="absolute bottom-2 left-2 right-2">
          <div className="rounded-2xl border border-white/50 bg-white/30 p-2 shadow-[0_24px_80px_-30px_rgba(15,23,42,0.35)] backdrop-blur-2xl">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
              Recent tickets
            </div>
            <div className="flex flex-wrap gap-2">
              {recentTickets.length > 0 ? recentTickets.map((ticket, index) => {
                const compactLabel = ticket.title.length > 36
                  ? `${ticket.title.slice(0, 33).replace(/\s+\S*$/, '').trimEnd()}...`
                  : ticket.title;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => {
                      setSelectedTicket(ticket);
                      onOpenExistingTicket?.(ticket);
                    }}
                    className="animate-ticket-chip-in max-w-[220px] rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-slate-900"
                    style={{ animationDelay: `${index * 90}ms` }}
                    title={`${ticket.id} - ${ticket.title}`}
                  >
                    <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{compactLabel}</span>
                  </button>
                );
              }) : (
                <span className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm">
                  No recent tickets
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col bg-background">
        <div className="animate-chat-header-in flex items-center justify-between border-b border-blue-100/80 bg-gradient-to-r from-white via-blue-50/40 to-indigo-50/30 px-4 py-2.5 shadow-[0_1px_8px_rgba(15,23,42,0.06)]">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-blue-300/80 bg-gradient-to-br from-blue-100 to-indigo-100 shadow-[0_4px_14px_rgba(79,70,229,0.18)]">
              <img
                src="/download-1.png"
                alt="Athena"
                className="-scale-x-100 h-10 w-10 rounded-full object-cover transition duration-500"
                style={{ filter: 'hue-rotate(225deg) saturate(1.45) contrast(1.08)' }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-slate-950">Athena</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 shadow-sm">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Online
                </span>
                <span className="hidden rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600 sm:inline-flex">
                  {providerBadgeLabel}
                </span>
              </div>
              <p className="truncate text-xs text-slate-500">Your AI ops assistant · Physique 57 India</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ChatExportMenu
              disabled={messages.length === 0 || Boolean(exportingFormat)}
              exportingPng={exportingFormat === 'png'}
              copyState={copyTranscriptState}
              onExportText={exportTranscriptText}
              onExportHtml={exportTranscriptHtml}
              onExportPng={exportTranscriptPng}
              onCopyTranscript={copyTranscript}
            />
          </div>
        </div>

        {instructorEvaluationMode ? (
          <div className="chat-scrollbar flex-1 overflow-y-auto bg-blue-50/60 px-4 py-4 shadow-inner sm:px-6">
            <div className="mx-auto flex min-h-full max-w-7xl items-stretch">
              <InstructorEvaluationChatbox
                onSubmit={submitInstructorEvaluation}
                disabled={loading}
              />
            </div>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="chat-scrollbar mx-auto w-full max-w-7xl flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 lg:py-5"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='180' height='180' viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Ctext x='24' y='42' font-size='11' font-family='Inter,Arial,sans-serif' fill='%231e293b' fill-opacity='0.05'%3EP57%3C/text%3E%3Ccircle cx='124' cy='54' r='9' stroke='%231e293b' stroke-opacity='0.045' stroke-width='1.2'/%3E%3Cpath d='M35 122h22M46 111v22' stroke='%231e293b' stroke-opacity='0.045' stroke-width='1.8' stroke-linecap='round'/%3E%3C/g%3E%3C/svg%3E")`,
              backgroundColor: '#f3f4f6',
            }}
          >
            {messages.map((m, index) => (
              <MessageBubble
                key={m.id}
                message={m}
                index={index}
                onChipClick={handleChipClick}
                onDetailFormSubmit={submitDetailForm}
                onOpenDraftReview={(messageId) => setActiveDraftReviewMessageId(messageId)}
                context={context}
                showDebugTrace={athenaDebugTraceEnabled}
              />
            ))}
            {!loading && messages.length === 1 && (
              <div className="animate-p57-fade-up mt-2 space-y-3">
                <p className="text-[11px] font-medium text-slate-400">Not sure how to start? Try one of these:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    'A member complained about the AC at Bandra studio',
                    'Member Smita Modi wants a refund for her last class',
                    'Member Preeti Ambani reported money theft from the locker room at Kemps',
                    'Equipment issue - Cycle monitor not working at the Bandra Studio',
                    'Instructor arrived late for the barre class',
                  ].map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => { setInput(starter); textareaRef.current?.focus(); }}
                      className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[12.5px] text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:shadow"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {loading && <TypingIndicator />}
          </div>
        )}

        <Dialog
          open={Boolean(activeDraftReviewMessage)}
          onOpenChange={(open) => {
            if (!open) setActiveDraftReviewMessageId(null);
          }}
        >
          <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-slate-200 bg-slate-50/95 p-4 shadow-[0_30px_100px_rgba(15,23,42,0.28)] data-[state=open]:zoom-in-90 sm:rounded-3xl sm:p-5">
            <DialogHeader className="pr-8">
              <DialogTitle className="text-base text-slate-950">Review Athena ticket draft</DialogTitle>
              <DialogDescription>
                Check the context, routing, and Momence signals before publishing.
              </DialogDescription>
            </DialogHeader>
            {activeDraftReviewMessage?.ticket && (
              <DraftTicketReviewPreview
                draft={mergeDraftWithContext(activeDraftReviewMessage.ticket, context)}
                context={context}
                tickets={tickets}
                onConfirm={() => onConfirmDraftFromMessage(activeDraftReviewMessage)}
                onEdit={() => refineDraft()}
                onDiscard={() => discardDraft(activeDraftReviewMessage.id)}
                onSaveEdit={(draft) => saveEditedDraft(activeDraftReviewMessage.id, draft)}
                confirmed={activeDraftReviewMessage.published}
                ticketId={activeDraftReviewMessage.ticketId}
                confirmedTicket={activeDraftReviewMessage.publishedTicket}
                publishing={publishingRef.current.has(activeDraftReviewMessage.id)}
              />
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={textToTicketOpen} onOpenChange={setTextToTicketOpen}>
          <DialogContent className="max-w-2xl border-slate-200 bg-white p-5 shadow-[0_30px_100px_rgba(15,23,42,0.25)] sm:rounded-3xl">
            <DialogHeader>
              <DialogTitle className="text-base text-slate-950">Text to ticket</DialogTitle>
              <DialogDescription>
                Paste review notes or performance text. Athena will extract a structured ticket draft for review.
              </DialogDescription>
            </DialogHeader>
            <textarea
              value={textToTicketText}
              onChange={(event) => setTextToTicketText(event.target.value)}
              rows={9}
              placeholder="Paste the source text here..."
              className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-relaxed text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTextToTicketOpen(false)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitTextToTicket}
                disabled={!textToTicketText.trim()}
                className="h-9 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white shadow-[0_12px_26px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Generate draft
              </button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!instructorEvaluationMode && Boolean(activeTemplate)}
          onOpenChange={(open) => {
            if (!open) setActiveTemplate(null);
          }}
        >
          <DialogContent className="fixed left-[50%] top-[50%] z-[100] flex max-h-[90vh] !w-[min(1440px,calc(100vw-2rem))] !max-w-[min(1440px,calc(100vw-2rem))] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-3xl border-slate-200 bg-slate-50/98 p-0 shadow-[0_30px_100px_rgba(15,23,42,0.30)] data-[state=open]:zoom-in-95">
            {activeTemplate && (
              <>
                <DialogHeader className="shrink-0 border-b border-slate-200 bg-white/95 px-6 py-4 pr-12 text-left">
                  <DialogTitle className="text-base text-slate-950">{activeTemplate.label}</DialogTitle>
                  <DialogDescription>{activeTemplate.description}</DialogDescription>
                </DialogHeader>
                <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
                  {activeTemplate.id === 'hosted-class-feedback' ? (
                    <HostedClassTemplateForm
                      template={activeTemplate}
                      disabled={loading}
                      onCancel={() => setActiveTemplate(null)}
                      onSubmit={(payload) => {
                        const nextContext: DetailContext = {
                          ...context,
                          intakeRoute: activeTemplate.intakeRoute,
                          category: activeTemplate.category,
                          subCategory: activeTemplate.subCategory,
                          priority: activeTemplate.priority,
                          sessionId: payload.session.id,
                          classType: payload.session.classType,
                          classDateTime: payload.session.startsAt,
                          trainer: payload.session.trainer,
                          studio: payload.session.studio,
                          reportedBy: reporterName,
                          partnerName: payload.partnerName,
                          description: payload.classFeedback,
                        };
                        setContext(nextContext);
                        setActiveTemplate(null);
                        sendMessage(buildHostedClassFeedbackText(payload), nextContext);
                      }}
                    />
                  ) : (
                    <DetailCaptureForm
                      form={templateDetailFormFromTemplate(activeTemplate)}
                      initialContext={context}
                      disabled={loading}
                      onSubmit={(values, form) => {
                        const nextContext: DetailContext = {
                          ...context,
                          ...values,
                          intakeRoute: activeTemplate.intakeRoute,
                          category: activeTemplate.category,
                          subCategory: activeTemplate.subCategory,
                          priority: activeTemplate.priority,
                          reportedBy: reporterName,
                          description: Object.values(values).filter(Boolean).join('\n'),
                        };
                        setContext(nextContext);
                        setActiveTemplate(null);
                        sendMessage(buildContextTemplateText(activeTemplate, values), nextContext);
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {!instructorEvaluationMode && (
        <>
        <div className="z-10 flex-shrink-0 border-t border-border/50 bg-[#f0f2f5] px-4 py-2.5 shadow-[0_-12px_30px_rgba(15,23,42,0.04)] sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-700">
                Context
              </span>
              <div className="hidden h-5 w-px bg-slate-200 sm:block" />
            </div>
            <div className="min-w-0 flex-1 overflow-x-auto pb-0.5">
              <ContextPicker
                context={context}
                attachmentCount={pendingAttachments.length}
                accent="blue"
                onChange={(next) => setContext((current) => ({ ...current, ...next }))}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TemplatePicker onSelect={applyTemplate} />
              <button
                type="button"
                onClick={() => setTextToTicketOpen(true)}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Text to ticket</span>
              </button>
            </div>
          </div>
        </div>

        <div className="z-10 flex-shrink-0 border-t border-border/50 bg-[#f0f2f5] px-4 py-3 sm:px-6">
          <div className="mx-auto flex w-full max-w-7xl items-end gap-3">
            <div className="flex-1 relative">
              {isUrgentInput && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 shadow-sm">
                  <span>⚡</span>
                  <span>High-priority signals detected — Athena will flag this appropriately</span>
                </div>
              )}
              {capturedContextSummary.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {capturedContextSummary.map((item) => (
                    <span key={item} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm">
                      {item}
                    </span>
                  ))}
                </div>
              )}
              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {pendingAttachments.map((entry) => (
                    <span
                      key={entry.id}
                      className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-700"
                      title={`${entry.file.name} (${Math.max(1, Math.round(entry.file.size / 1024))} KB)`}
                    >
                      <Paperclip className="h-3 w-3 shrink-0 text-blue-600" />
                      <span className="truncate">{entry.file.name}</span>
                      <button
                        type="button"
                        onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== entry.id))}
                        className="rounded-full p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        aria-label={`Remove ${entry.file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder="Tell me what happened — I'll take care of the rest…"
              className={`max-h-28 w-full resize-none rounded-full border border-slate-200 bg-white px-4 py-3 pr-12 text-sm text-slate-950 shadow-[0_12px_34px_rgba(15,23,42,0.07)] outline-none transition duration-200 placeholder:text-slate-400 focus:ring-4 ${
                instructorEvaluationMode ? 'focus:border-blue-400 focus:ring-blue-500/15' : 'focus:border-blue-400 focus:ring-blue-500/15'
              }`}
                style={{ minHeight: '48px' }}
              />
              <button
                type="button"
                disabled={!input.trim() || loading}
                onClick={() => {
                  const optimized = optimizeIntakePromptForAthena(input);
                  if (optimized && optimized !== input) {
                    setInput(optimized);
                  }
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
                className="absolute right-2 top-1.5 flex h-9 w-9 items-center justify-center rounded-full border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-600 shadow-[0_2px_8px_rgba(79,70,229,0.12)] transition hover:-translate-y-0.5 hover:from-blue-100 hover:to-indigo-100 hover:text-indigo-700 hover:shadow-[0_4px_12px_rgba(79,70,229,0.20)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
                title="Polish your text — expands abbreviations and cleans up common shorthand"
                aria-label="Optimise prompt for Athena"
              >
                <Sparkles className="h-4 w-4" />
              </button>
              {listening && (
                <div className="mt-1 text-[10px] font-medium text-blue-700">
                  {voiceHint || (voiceLiveText ? 'Listening… capturing your description' : 'Listening… start speaking')}
                </div>
              )}
              {smartVoiceHints.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {smartVoiceHints.map((hint) => (
                    <span
                      key={hint}
                      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10.5px] font-semibold text-blue-700 shadow-sm"
                    >
                      {hint}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"
              onChange={(event) => {
                addAttachments(event.target.files);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
                className={`flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 ${
                  instructorEvaluationMode ? 'hover:border-blue-200 hover:text-blue-700' : 'hover:border-blue-200 hover:text-blue-700'
                }`}
              title="Attach files"
              aria-label="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {voiceSupported && (
              <button
                type="button"
                onClick={listening ? stopVoiceCapture : startVoiceCapture}
                disabled={loading}
                className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-sm transition ${
                  listening
                    ? instructorEvaluationMode
                      ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                      : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    : `border-slate-200 bg-white text-slate-600 hover:-translate-y-0.5 ${instructorEvaluationMode ? 'hover:border-blue-200 hover:text-blue-700' : 'hover:border-blue-200 hover:text-blue-700'}`
                } disabled:cursor-not-allowed disabled:opacity-45`}
                title={listening ? 'Stop voice input' : 'Start voice input'}
                aria-label={listening ? 'Stop voice input' : 'Start voice input'}
              >
                {listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35 ${
                instructorEvaluationMode
                  ? 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-700'
                  : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-700'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="mx-auto mt-1 w-full max-w-7xl px-1 text-[10px] font-medium text-slate-400">
            Press Enter to send · Shift+Enter for new line · Attachments welcome if they help paint the picture
          </p>
        </div>
        </>
        )}
      </div>

      <div className="hidden xl:flex h-full w-[240px] 2xl:w-[260px] shrink-0 flex-col border-l border-slate-100 bg-slate-50/40 overflow-hidden">
        <LiveTicketBuilder
          context={context}
          activeDraft={activeDraftReviewMessage?.ticket ?? null}
        />
      </div>
    </div>
  );
};

const ChatExportMenu: React.FC<{
  disabled?: boolean;
  exportingPng?: boolean;
  copyState?: 'idle' | 'copied';
  onExportText: () => void;
  onExportHtml: () => void;
  onExportPng: () => void | Promise<void>;
  onCopyTranscript: () => Promise<void>;
}> = ({ disabled = false, exportingPng = false, copyState = 'idle', onExportText, onExportHtml, onExportPng, onCopyTranscript }) => {
  const [open, setOpen] = useState(false);
  const runAction = (action: () => void | Promise<void>) => {
    setOpen(false);
    void action();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45"
          title="Export chat conversation"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-56 overflow-hidden rounded-2xl border-slate-200 bg-white/96 p-1.5 shadow-[0_24px_70px_rgba(15,23,42,0.14)] backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={() => runAction(onCopyTranscript)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
        >
          {copyState === 'copied' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copyState === 'copied' ? 'Copied!' : 'Copy transcript'}
        </button>
        <div className="my-1 h-px bg-slate-100" />
        <button
          type="button"
          onClick={() => runAction(onExportText)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
        >
          <FileText className="h-3.5 w-3.5" />
          Text transcript
        </button>
        <button
          type="button"
          onClick={() => runAction(onExportHtml)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
        >
          <FileCode2 className="h-3.5 w-3.5" />
          HTML transcript
        </button>
        <button
          type="button"
          onClick={() => runAction(onExportPng)}
          disabled={exportingPng}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ImageDown className="h-3.5 w-3.5" />
          {exportingPng ? 'Preparing PNG...' : 'PNG screenshot'}
        </button>
      </PopoverContent>
    </Popover>
  );
};

const TemplatePicker: React.FC<{ onSelect: (template: ContextTemplate) => void }> = ({ onSelect }) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          Templates
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border-slate-200 bg-white/96 p-0 shadow-[0_24px_70px_rgba(15,23,42,0.14)] backdrop-blur-xl"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">Ready templates</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Select a common context template, complete the blanks, then send to Athena.
          </p>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2">
          {CONTEXT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                onSelect(template);
                setOpen(false);
              }}
              className="block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-blue-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-950">{template.label}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{template.description}</div>
                </div>
                <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  {template.priority}
                </span>
              </div>
              <div className="mt-2 truncate text-[11px] font-medium text-blue-700">
                {template.category} · {template.subCategory}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const HOSTED_ATTENDEE_STATUS_OPTIONS = [
  'Booked / not checked in',
  'Checked in / attended',
  'Cancelled before class',
  'Late arrival noted',
  'No-show / absent',
  'Interested in continuing',
  'Needs follow-up',
  'Converted / package sold',
  'Concern raised',
  'Not a fit',
];

const HOSTED_FOLLOW_UP_OPTIONS = [
  'No follow-up needed',
  'WhatsApp same day',
  'Phone call',
  'Email package details',
  'Invite to intro offer',
  'Client success follow-up',
  'Partner follow-up',
];

const HOSTED_PARTNER_TYPE_OPTIONS = [
  'Influencer / creator',
  'Wellness partner',
  'Corporate / brand partner',
  'Community builder',
  'Member-hosted group',
  'Other',
];

const HOSTED_SOURCE_OPTIONS = [
  'Partner referral',
  'Instagram / social',
  'Existing member guest',
  'Corporate community',
  'Walk-in / studio invite',
  'Other',
];

const HOSTED_AUDIENCE_FIT_OPTIONS = [
  'Strong P57 fit',
  'Good fit with nurturing',
  'Mixed audience fit',
  'Low conversion fit',
  'Unable to determine',
];

const HOSTED_PARTNER_RESPONSE_OPTIONS = [
  'Partner expressed strong satisfaction',
  'Partner expressed mixed feedback',
  'Partner requested another collaboration',
  'Partner requested changes before repeating',
  'No partner feedback captured',
];

const HOSTED_ARRIVAL_PATTERN_OPTIONS = [
  'No late arrivals noted',
  '1-2 late arrivals',
  '3+ late arrivals',
  'Late arrivals affected class flow',
  'Unable to determine',
];

const HOSTED_CONVERSION_OPTIONS = [
  'Strong package interest',
  'Intro offer interest',
  'Needs nurturing',
  'Low purchase intent',
  'Package sold',
  'Unable to determine',
];

const HOSTED_SOCIAL_OPTIONS = [
  'Partner will post',
  'P57 content opportunity',
  'Testimonials captured',
  'No content opportunity',
  'Follow up for assets',
];

const HOSTED_FOLLOW_UP_PLAN_OPTIONS = [
  'No follow-up needed',
  'WhatsApp interested guests today',
  'Call high-intent guests',
  'Email intro package details',
  'Schedule partner debrief',
  'Escalate to sales lead',
];

const HOSTED_CLASS_SESSION_TYPES = ['private'];

function momenceBookingMemberName(booking: MomenceSessionBooking): string {
  const name = [booking.member?.firstName, booking.member?.lastName].filter(Boolean).join(' ').trim();
  return name || `Momence member #${booking.member?.id || booking.id}`;
}

function momenceBookingContact(booking: MomenceSessionBooking): string {
  return [booking.member?.email, booking.member?.phoneNumber].filter(Boolean).join(' · ');
}

function hostedBookingStatus(booking: MomenceSessionBooking): string {
  if (booking.cancelledAt) return 'Cancelled before class';
  if (booking.checkedIn) return 'Checked in / attended';
  return 'Booked / not checked in';
}

function hostedStatusTone(status: string): string {
  if (/converted|package sold/i.test(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (/checked in|attended|interested/i.test(status)) return 'border-blue-200 bg-blue-50 text-blue-800';
  if (/cancelled|no-show|absent|not a fit/i.test(status)) return 'border-slate-200 bg-slate-100 text-slate-700';
  if (/concern|late/i.test(status)) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-white text-slate-700';
}

function sessionSummaryFromOption(session: MomenceSessionOption): HostedClassSessionSummary {
  return {
    id: session.id,
    classType: session.classType,
    trainer: session.trainer,
    studio: session.studio,
    startsAt: session.startsAt,
  };
}

function formatHostedSessionDateTime(value?: string): string {
  if (!value) return 'Date not returned';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function toDateTimeLocalInputValue(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').slice(0, 16);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

const templateDetailFormFromTemplate = (template: ContextTemplate): DetailForm => ({
  id: template.id,
  title: `${template.label} details`,
  description: template.description,
  fields: (template.fields || template.prompts.map((prompt): ContextTemplateField => ({
    id: prompt,
    label: prompt.replace(/:\s*$/, ''),
    type: /feedback|concern|impact|action|notes|comment|resolution/i.test(prompt) ? 'textarea' : 'text',
    required: true,
  }))).map((field): DetailFormField => ({
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options || templateFieldOptions(field.id),
    placeholder: field.placeholder,
    dependsOn: field.dependsOn,
    dependsOnValue: field.dependsOnValue,
    section: field.section,
    scoreWeight: field.scoreWeight,
  })),
  submitLabel: 'Generate ticket draft',
});

function templateFieldOptions(fieldId: string): string[] | undefined {
  if (fieldId === 'studio') return STUDIOS;
  if (fieldId === 'trainer') return TRAINERS;
  return undefined;
}

const HostedClassTemplateForm: React.FC<{
  template: ContextTemplate;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (payload: HostedClassFeedbackInput) => void;
}> = ({ template, disabled = false, onCancel, onSubmit }) => {
  const [sessionValues, setSessionValues] = useState<Record<string, string>>({});
  const [selectedSession, setSelectedSession] = useState<HostedClassSessionSummary | null>(null);
  const [attendees, setAttendees] = useState<HostedClassAttendeeFeedback[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState('');
  const [partnerType, setPartnerType] = useState('');
  const [acquisitionSource, setAcquisitionSource] = useState('');
  const [audienceFit, setAudienceFit] = useState('');
  const [classFeedback, setClassFeedback] = useState('');
  const [hostFeedback, setHostFeedback] = useState(HOSTED_PARTNER_RESPONSE_OPTIONS[0]);
  const [lateComerFeedback, setLateComerFeedback] = useState(HOSTED_ARRIVAL_PATTERN_OPTIONS[0]);
  const [otherFeedback, setOtherFeedback] = useState('');
  const [conversionSummary, setConversionSummary] = useState(HOSTED_CONVERSION_OPTIONS[0]);
  const [socialAmplification, setSocialAmplification] = useState(HOSTED_SOCIAL_OPTIONS[0]);
  const [followUpPlan, setFollowUpPlan] = useState(HOSTED_FOLLOW_UP_PLAN_OPTIONS[1]);
  const canSubmit = Boolean(selectedSession && classFeedback.trim()) && !disabled;
  const hostedTemplateProgress = [
    { label: 'Session', value: selectedSession ? 'Selected' : 'Required', complete: Boolean(selectedSession) },
    { label: 'Member feedback', value: classFeedback.trim() ? 'Captured' : 'Required', complete: Boolean(classFeedback.trim()) },
    { label: 'Follow-up', value: followUpPlan || 'Pending', complete: Boolean(followUpPlan) },
  ];

  const selectSession = async (session: MomenceSessionOption) => {
    const summary = sessionSummaryFromOption(session);
    setSelectedSession(summary);
    setSessionValues({
      sessionId: summary.id,
      classType: summary.classType,
      classDateTime: summary.startsAt || '',
      trainer: summary.trainer || '',
      studio: summary.studio || '',
    });
    setLoadingBookings(true);
    setBookingError(null);
    try {
      const bookings = await getMomenceSessionBookings(session.id);
      setAttendees(bookings.map((booking) => ({
        bookingId: String(booking.id),
        memberName: momenceBookingMemberName(booking),
        memberContact: momenceBookingContact(booking),
        status: hostedBookingStatus(booking),
        followUpPreference: 'No follow-up needed',
        conversionSignal: '',
        comment: '',
      })));
    } catch (error) {
      setAttendees([]);
      setBookingError(error instanceof Error ? error.message : 'Could not load class attendees.');
    } finally {
      setLoadingBookings(false);
    }
  };

  const updateAttendee = (bookingId: string, patch: Partial<HostedClassAttendeeFeedback>) => {
    setAttendees((current) => current.map((attendee) => (
      attendee.bookingId === bookingId ? { ...attendee, ...patch } : attendee
    )));
  };

  return (
    <form
      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selectedSession || !canSubmit) return;
        onSubmit({
          partnerName,
          partnerType,
          acquisitionSource,
          audienceFit,
          session: selectedSession,
          attendees,
          classFeedback,
          hostFeedback,
          lateComerFeedback,
          otherFeedback,
          conversionSummary,
          socialAmplification,
          followUpPlan,
        });
      }}
    >
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700 shadow-sm">
              <LayoutTemplate className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">Hosted class template</div>
              <h3 className="mt-1 text-base font-semibold text-slate-950">{template.label}</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">Partner audience insight, attendee response, and conversion follow-up for Signature Partnership Experiences.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div aria-label="Hosted template progress" className="grid min-w-[min(100%,390px)] grid-cols-3 gap-2">
              {hostedTemplateProgress.map((item) => (
                <div
                  key={item.label}
                  className={`rounded-2xl border px-3 py-2 ${
                    item.complete
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                >
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-70">{item.label}</div>
                  <div className="mt-1 truncate text-[11px] font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
          <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Momence source</div>
                <h4 className="mt-1 text-sm font-semibold text-slate-950">Selected session</h4>
              </div>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700">Private hosted</span>
            </div>
            <MomenceSessionDropdownField
              multi={false}
              sessionTypes={HOSTED_CLASS_SESSION_TYPES}
              values={sessionValues}
              onChange={async (sessions) => {
                const session = sessions[0];
                if (!session) {
                  setSelectedSession(null);
                  setSessionValues({});
                  setAttendees([]);
                  return;
                }
                await selectSession(session);
              }}
            />
            {selectedSession && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[
                  { label: 'Class', value: selectedSession.classType || 'Class not returned' },
                  { label: 'Date', value: formatHostedSessionDateTime(selectedSession.startsAt) },
                  { label: 'Studio', value: selectedSession.studio || 'Studio not returned' },
                  { label: 'Instructor', value: selectedSession.trainer || 'Instructor not returned' },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
                    <div className="mt-1 truncate text-xs font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Partner signal</div>
                <h4 className="mt-1 text-sm font-semibold text-slate-950">Partnership context</h4>
              </div>
              <ClipboardCheck className="h-4 w-4 text-blue-600" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TemplateTextInput label="Partner / host" value={partnerName} onChange={setPartnerName} />
              <TemplateSelect label="Partner type" value={partnerType} options={HOSTED_PARTNER_TYPE_OPTIONS} onChange={setPartnerType} />
              <TemplateSelect label="Attendance source" value={acquisitionSource} options={HOSTED_SOURCE_OPTIONS} onChange={setAcquisitionSource} />
              <TemplateSelect label="Audience fit" value={audienceFit} options={HOSTED_AUDIENCE_FIT_OPTIONS} onChange={setAudienceFit} />
            </div>
          </section>
        </div>
        {bookingError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{bookingError}</div>}
        {loadingBookings && <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">Loading class attendees from Momence...</div>}

        <div className="grid gap-4 xl:grid-cols-[minmax(520px,1.1fr)_minmax(420px,0.9fr)]">
          <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Momence bookings</div>
                <h4 className="mt-1 text-sm font-semibold text-slate-950">Attendee response</h4>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                {selectedSession ? `${attendees.length} loaded` : 'Awaiting session'}
              </div>
            </div>
            {selectedSession && (
              <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                {attendees.length ? attendees.map((attendee) => (
                  <div key={attendee.bookingId} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_180px_190px]">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-[11px] font-bold text-blue-700">
                          {attendee.memberName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-slate-950">{attendee.memberName}</div>
                          {attendee.memberContact && <div className="mt-0.5 truncate text-[11px] text-slate-500">{attendee.memberContact}</div>}
                        </div>
                      </div>
                      <input
                        value={attendee.comment || ''}
                        onChange={(event) => updateAttendee(attendee.bookingId, { comment: event.target.value })}
                        placeholder="Optional member feedback note"
                        className="mt-2 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-950 outline-none transition hover:bg-white focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      />
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Attendance status</span>
                      <select
                        value={attendee.status}
                        onChange={(event) => updateAttendee(attendee.bookingId, { status: event.target.value })}
                        className={`h-10 w-full rounded-xl border px-2 text-xs font-semibold outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 ${hostedStatusTone(attendee.status)}`}
                      >
                        {Array.from(new Set([attendee.status, ...HOSTED_ATTENDEE_STATUS_OPTIONS])).map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Attendee follow-up</span>
                      <select
                        value={attendee.followUpPreference || HOSTED_FOLLOW_UP_OPTIONS[0]}
                        onChange={(event) => updateAttendee(attendee.bookingId, { followUpPreference: event.target.value })}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      >
                        {HOSTED_FOLLOW_UP_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-xs text-slate-500">
                    No attendees returned for this Momence class.
                  </div>
                )}
              </div>
            )}
            {!selectedSession && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm leading-relaxed text-slate-500">
                Awaiting hosted Momence session selection.
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Ticket intelligence</div>
                <h4 className="mt-1 text-sm font-semibold text-slate-950">Feedback and follow-up</h4>
              </div>
              <Gauge className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="grid content-start gap-3 sm:grid-cols-2">
              <TemplateSelect label="Partner response" value={hostFeedback} options={HOSTED_PARTNER_RESPONSE_OPTIONS} onChange={setHostFeedback} />
              <TemplateSelect label="Arrival pattern" value={lateComerFeedback} options={HOSTED_ARRIVAL_PATTERN_OPTIONS} onChange={setLateComerFeedback} />
              <TemplateSelect label="Conversion signal" value={conversionSummary} options={HOSTED_CONVERSION_OPTIONS} onChange={setConversionSummary} />
              <TemplateSelect label="Social opportunity" value={socialAmplification} options={HOSTED_SOCIAL_OPTIONS} onChange={setSocialAmplification} />
              <TemplateSelect label="Follow-up plan" value={followUpPlan} options={HOSTED_FOLLOW_UP_PLAN_OPTIONS} onChange={setFollowUpPlan} />
              <TemplateTextarea label="Member feedback highlights" required value={classFeedback} onChange={setClassFeedback} />
              <TemplateTextarea label="Additional context" value={otherFeedback} onChange={setOtherFeedback} />
            </div>
          </section>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${selectedSession ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            <CheckCircle2 className="h-3 w-3" />
            {selectedSession ? 'Session selected' : 'Session required'}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${classFeedback.trim() ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            <CheckCircle2 className="h-3 w-3" />
            {classFeedback.trim() ? 'Member feedback captured' : 'Member feedback required'}
          </span>
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-45"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Generate ticket draft
        </button>
      </div>
    </form>
  );
};

const TemplateTextarea: React.FC<{
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}> = ({ label, value, required = false, onChange }) => (
  <label className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100 sm:col-span-2">
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {label}
      {required ? <span className="text-blue-700"> *</span> : null}
    </span>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={3}
      className="mt-2 min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-950 outline-none transition hover:bg-white focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
    />
    <SuggestionChips suggestions={suggestionsForTemplateTextField(label)} onPick={onChange} />
  </label>
);

const TemplateTextInput: React.FC<{
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}> = ({ label, value, required = false, onChange }) => (
  <label className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100">
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {label}
      {required ? <span className="text-blue-700"> *</span> : null}
    </span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 outline-none transition hover:bg-white focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
    />
    <SuggestionChips suggestions={suggestionsForTemplateTextField(label)} onPick={onChange} />
  </label>
);

function suggestionsForTemplateTextField(label: string): string[] {
  const normalized = label.toLowerCase();
  if (/member feedback|feedback|highlight|comment/.test(normalized)) {
    return [
      'Member reported that the touchpoint affected their overall studio journey.',
      'Member expressed appreciation for the instructor support and class energy.',
      'Member stated that they would like a follow-up before their next visit.',
    ];
  }
  if (/partner|influencer|host/.test(normalized)) {
    return [
      'Partner audience showed strong alignment with the P57 community.',
      'Partner requested follow-up on future Signature Partnership Experiences.',
      'Attendees mentioned discovering Physique 57 through the partner invitation.',
    ];
  }
  if (/context|note|detail|reason|concern|issue|resolution|action/.test(normalized)) {
    return [
      'Member reported the concern in person after the studio session.',
      'Team member offered an immediate workaround and member accepted follow-up.',
      'Member requested a clear resolution timeline and preferred WhatsApp follow-up.',
    ];
  }
  return [];
}

function suggestionsForDetailField(field: DetailFormField): string[] {
  const id = field.id;
  const label = field.label.toLowerCase();
  if (id === 'memberFeedback') {
    return [
      '"I was told I couldn\'t enter even though I was only 2 minutes late — this has never happened before."',
      '"The instructor didn\'t seem to notice the issue during class and I felt uncomfortable raising it."',
      '"I was really happy with the session today — the instructor\'s energy was amazing."',
    ];
  }
  if (id === 'policyExplanation') {
    return [
      'Explained that our policy is to close the studio door 5 minutes after the session starts to protect the member experience.',
      'Informed the member that late entry is not permitted once the warm-up has begun, as per Physique 57 policy.',
      'Policy was not formally explained at the time — member was turned away without a written or verbal reason.',
    ];
  }
  if (id === 'lateArrivalReason') {
    return [
      'Member cited heavy traffic and difficulty finding parking near the studio.',
      'Member stated their Momence booking confirmation showed a different class time.',
      'Member mentioned a work obligation that ran over and said this was a one-off situation.',
    ];
  }
  if (id === 'alternativeSolution') {
    return [
      'Offered a complimentary class credit to the member\'s Momence account as a goodwill gesture.',
      'Transferred the member\'s booking to the next available session at no extra charge.',
      'No alternative was offered — member was turned away and no follow-up was initiated.',
    ];
  }
  if (id === 'requestedResolution' || id === 'requestedChange') {
    return [
      'Member requested a class credit and a written apology from the studio manager.',
      'Member asked for a callback within 24 hours to confirm the resolution.',
      'Member requested the late-arrival policy be reviewed and communicated more clearly to members.',
    ];
  }
  if (id === 'reportedImpact') {
    return [
      'Member felt unwelcome and stated they are reconsidering their membership renewal.',
      'Member left without attending the session and said the experience affected their confidence in the studio.',
      'Member was frustrated but remained calm — noted the issue was a first occurrence for them.',
    ];
  }
  if (id === 'immediateAction') {
    return [
      'Apologised to the member on behalf of the studio and escalated to the studio manager.',
      'Offered a complimentary session credit immediately and logged the concern in Momence.',
      'No immediate action taken — member left before any resolution could be offered.',
    ];
  }
  if (id === 'sessionFeedback') {
    return [
      'Member noted the instructor\'s cues were unclear during the tuck sequence and asked for more corrections.',
      'Member commented that the music was too loud and affected their ability to follow instructions.',
      'Member praised the energy in the room but felt the pacing was faster than usual for this class type.',
    ];
  }
  if (id === 'studioArea') {
    return [
      'Locker room — member reported a broken lock on locker #12 and visible mould near the showers.',
      'PowerCycle studio — bike near the door had a loose handlebar that was flagged during class.',
      'Reception and waiting area — member noted the area felt overcrowded before the 7 AM class.',
    ];
  }
  if (id.toLowerCase().includes('description') || /describe|issue|detail/.test(label)) {
    return [
      'Member reported the concern during a studio touchpoint and requested follow-up.',
      'Member stated the issue affected their session experience and wants a resolution timeline.',
      'Team member documented the concern with studio, session, and member impact context.',
    ];
  }
  if (id.toLowerCase().includes('resolution') || /resolution|outcome|action/.test(label)) {
    return [
      'Member requested a callback with the confirmed next step.',
      'Member requested written confirmation by WhatsApp or email.',
      'Team member offered an interim solution while the issue is reviewed.',
    ];
  }
  if (id.toLowerCase().includes('feedback') || /feedback|comment/.test(label)) {
    return [
      'Member expressed mixed feedback and asked that the concern be shared internally.',
      'Member complimented the instructor and noted the class energy felt strong.',
      'Member stated the touchpoint did not meet their expected Physique 57 standard.',
    ];
  }
  return suggestionsForTemplateTextField(field.label);
}

const SuggestionChips: React.FC<{ suggestions: string[]; onPick: (value: string) => void }> = ({ suggestions, onPick }) => (
  <div className="mt-2 flex flex-wrap gap-1.5">
    {suggestions.slice(0, 3).map((suggestion) => (
      <button
        key={suggestion}
        type="button"
        onClick={() => onPick(suggestion)}
        className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-left text-[10px] font-medium leading-snug text-blue-800 transition hover:border-blue-200 hover:bg-white"
        title={suggestion}
      >
        {suggestion}
      </button>
    ))}
  </div>
);

const TemplateSelect: React.FC<{
  label: string;
  value: string;
  options: string[];
  required?: boolean;
  onChange: (value: string) => void;
}> = ({ label, value, options, required = false, onChange }) => (
  <label className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100">
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {label}
      {required ? <span className="text-blue-700"> *</span> : null}
    </span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 outline-none transition hover:bg-white focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
    >
      <option value="">Select {label.toLowerCase()}</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  </label>
);

const MessageBubble: React.FC<{
  message: Message;
  index: number;
  onChipClick: (chip: SuggestedChip) => void;
  onDetailFormSubmit: (values: Record<string, string>, form?: DetailForm) => void;
  onOpenDraftReview: (messageId: string) => void;
  context: DetailContext;
  showDebugTrace: boolean;
}> = ({ message, index, onChipClick, onDetailFormSubmit, onOpenDraftReview, context, showDebugTrace }) => {
  const isUser = message.role === 'user';
  const userTone = USER_TONES[index % USER_TONES.length];
  const visibleChips = (message.suggestedChips || []).filter((chip) => !context[chip.field]);
  const [expanded, setExpanded] = useState(false);

  const renderContent = (text: string) => {
    const renderInline = (value: string) =>
      value.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={j}>{part.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={j}>{part}</React.Fragment>
        )
      );

    const blocks = text.split('\n\n').map((block) => block.trim()).filter(Boolean);
    return blocks.map((block, index) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const isList = lines.every((line) => /^-\s+/.test(line));
      if (isList) {
        return (
          <ul key={`b-${index}`} className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
            {lines.map((line, itemIndex) => (
              <li key={`li-${itemIndex}`}>{renderInline(line.replace(/^-\s+/, ''))}</li>
            ))}
          </ul>
        );
      }
      return (
        <p key={`b-${index}`} className={index === 0 ? '' : 'mt-2'}>
          {lines.map((line, lineIndex) => (
            <React.Fragment key={`l-${lineIndex}`}>
              {renderInline(line)}
              {lineIndex < lines.length - 1 && <br />}
            </React.Fragment>
          ))}
        </p>
      );
    });
  };
  const contentLines = message.content.split('\n');
  const shouldCollapse =
    isUser &&
    !message.ticket &&
    !message.detailForm &&
    (contentLines.length > 3 || message.content.length > 260);
  const previewContent = (() => {
    if (!shouldCollapse || expanded) return message.content;
    const firstLines = contentLines.slice(0, 3).join('\n');
    return firstLines.length > 260 ? `${firstLines.slice(0, 260).trimEnd()}...` : `${firstLines.trimEnd()}...`;
  })();

  return (
    <div
      className={`animate-chat-message-in flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
      style={{ animationDelay: `${Math.min(index * 28, 240)}ms` }}
    >
      {!isUser && message.aiGenerated && (
        <div
          className="mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-blue-200 bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 shadow-[0_2px_6px_rgba(79,70,229,0.15)]"
          title="AI generated"
          aria-label="AI generated"
        >
          <Sparkles className="h-3 w-3" />
        </div>
      )}
      <div className={`flex w-full items-end gap-2 ${isUser ? 'flex-row-reverse justify-end' : ''}`}>
        {!isUser && (
          <div className="h-8 w-8 rounded-full overflow-hidden bg-gradient-to-br from-blue-100 to-indigo-100 border-2 border-blue-200 flex-shrink-0 p-0.5 mb-0.5 shadow-sm">
            <img src="/download-1.png" alt="Athena" className="-scale-x-100 w-full h-full rounded-full object-cover" />
          </div>
        )}
        <div className={`${isUser ? 'ml-auto w-[52%] pl-12' : 'w-full pr-6'}`}>
          <div
            className={`relative inline-block w-full rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed ${
              isUser
                ? 'rounded-br-sm border border-indigo-500/40 bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_1px_2px_rgba(15,23,42,0.10),0_12px_30px_-14px_rgba(79,70,229,0.55)]'
                : 'rounded-bl-sm border border-slate-200/80 bg-white text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-14px_rgba(15,23,42,0.18)]'
            }`}
          >
            {renderContent(previewContent)}
            <span
              className={`absolute bottom-0 h-3 w-3 rotate-45 ${
                isUser
                  ? '-right-1.5 bg-indigo-600 border-r border-b border-indigo-500/40'
                  : '-left-1.5 bg-white border-l border-b border-slate-200/80'
              }`}
            />
            {shouldCollapse && (
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className={`mt-2 block text-xs font-semibold underline-offset-4 hover:underline ${
                  isUser ? 'text-blue-100 hover:text-white' : 'text-blue-700 hover:text-blue-900'
                }`}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>
      </div>

      {visibleChips.length > 0 && !message.ticket && (
        <div className="mt-3 w-full pr-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Quick answers</span>
            <div className="h-px flex-1 bg-slate-200/70" />
            <span className="text-[10px] text-slate-400">tap to select</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleChips.map((c, i) => (
              <button
                key={i}
                onClick={() => onChipClick(c)}
                style={{ animationDelay: `${i * 55}ms` }}
                className="animate-p57-fade-up inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-blue-700 shadow-[0_2px_10px_rgba(37,99,235,0.09)] transition duration-200 hover:-translate-y-0.5 hover:border-blue-400 hover:bg-blue-50 hover:shadow-[0_6px_16px_rgba(37,99,235,0.18)] active:scale-95"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {message.detailForm && !message.ticket && (
        <DetailCaptureForm form={message.detailForm} initialContext={context} onSubmit={onDetailFormSubmit} />
      )}

      {message.ticket && (
        <div className="mt-2 w-full">
          {message.published && message.ticketId ? (
            <PublishedTicketSummary ticketId={message.ticketId} ticket={message.publishedTicket} />
          ) : (
            <button
              type="button"
              onClick={() => onOpenDraftReview(message.id)}
              className="animate-draft-popout-cue flex w-full max-w-md items-center gap-3 rounded-2xl border border-blue-200 bg-gradient-to-r from-white to-blue-50/60 px-4 py-3.5 text-left shadow-[0_6px_24px_rgba(37,99,235,0.14)] transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-[0_10px_30px_rgba(37,99,235,0.20)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                <ClipboardCheck className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">Draft ready — tap to review ✅</span>
                <span className="block truncate text-xs text-slate-500">{message.ticket.title}</span>
              </span>
              <span className="rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[0_3px_10px_rgba(79,70,229,0.30)]">
                Review →
              </span>
            </button>
          )}
        </div>
      )}
      {message.published && !message.ticket && message.ticketId && (
        <PublishedTicketSummary ticketId={message.ticketId} ticket={message.publishedTicket} />
      )}

      {showDebugTrace && message.debugTrace && (
        (() => {
          const traceRecord = message.debugTrace as Record<string, unknown>;
          const final = traceRecord.final as Record<string, unknown> | undefined;
          const guard = traceRecord.guard as Record<string, unknown> | undefined;
          const steps = Array.isArray(traceRecord.decisionSteps) ? (traceRecord.decisionSteps as string[]) : [];
          const guardedMissingFields = Array.isArray(guard?.guardedMissingFields) ? (guard?.guardedMissingFields as string[]) : [];
          const finalDetailFormFieldIds = Array.isArray(final?.detailFormFieldIds) ? (final?.detailFormFieldIds as string[]) : [];
          return (
        <details className="mt-2 w-full rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-950 shadow-sm">
          <summary className="cursor-pointer font-semibold uppercase tracking-[0.14em] text-amber-800">
            Athena decision trace
          </summary>
          <div className="mt-2 space-y-2">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl bg-white/90 p-2">
                <div className="font-semibold text-amber-900">Final decision</div>
                <div className="mt-1 text-slate-700">Path: {String(traceRecord.path || 'n/a')}</div>
                <div className="text-slate-700">Needs more info: {String(final?.needsMoreInfo ?? false)}</div>
                <div className="text-slate-700">Ticket returned: {String(final?.ticketPresent ?? false)}</div>
                {finalDetailFormFieldIds.length > 0 && (
                  <div className="text-slate-700">Final form fields: {finalDetailFormFieldIds.join(', ')}</div>
                )}
              </div>
              <div className="rounded-xl bg-white/90 p-2">
                <div className="font-semibold text-amber-900">Guard fields</div>
                <div className="mt-1 text-slate-700">
                  {guardedMissingFields.length > 0 ? guardedMissingFields.join(', ') : 'None'}
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-white/90 p-2">
              <div className="font-semibold text-amber-900">Decision steps</div>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-slate-700">
                {steps.map((step: string, stepIndex: number) => (
                  <li key={stepIndex}>{step}</li>
                ))}
              </ol>
            </div>
            <pre className="max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-100">
              {JSON.stringify(message.debugTrace, null, 2)}
            </pre>
          </div>
        </details>
          );
        })()
      )}
    </div>
  );
};

function firstContextValue(value?: string | null): string | undefined {
  return value
    ?.split('|')
    .map((item) => item.trim())
    .find(Boolean);
}

const DraftTicketReviewPreview: React.FC<{
  draft: DraftTicket;
  context: DetailContext;
  tickets: Ticket[];
  onConfirm: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  onSaveEdit: (draft: DraftTicket) => void;
  confirmed?: boolean;
  ticketId?: string;
  confirmedTicket?: Ticket;
  publishing?: boolean;
}> = ({ draft, context, tickets, onConfirm, onEdit, onDiscard, onSaveEdit, confirmed, ticketId, confirmedTicket, publishing }) => {
  const [momenceSummary, setMomenceSummary] = useState<MomenceInsightSummary | undefined>();
  const [momenceLoading, setMomenceLoading] = useState(false);
  const [momenceError, setMomenceError] = useState<string | null>(null);
  const memberId = firstContextValue(context.memberId);
  const sessionId = firstContextValue(context.sessionId);

  useEffect(() => {
    if (!memberId && !sessionId) {
      setMomenceSummary(undefined);
      setMomenceError(null);
      setMomenceLoading(false);
      return;
    }

    let cancelled = false;
    setMomenceLoading(true);
    setMomenceError(null);
    loadMomenceTicketContext({ memberId, sessionId })
      .then((momenceContext) => {
        if (!cancelled) setMomenceSummary(momenceContext.summary);
      })
      .catch((error) => {
        if (!cancelled) {
          setMomenceSummary(undefined);
          setMomenceError(error instanceof Error ? error.message : 'Momence context unavailable');
        }
      })
      .finally(() => {
        if (!cancelled) setMomenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [memberId, sessionId]);

  const reviewContext = useMemo(() => contextFromDraft(draft, context), [context, draft]);
  const duplicateTicket = useMemo(
    () => findRelatedSubmittedTickets(`${draft.title}\n${draft.description}`, reviewContext, tickets.filter((ticket) => !isTrainerEvaluationProfileOnly(ticket))).exactDuplicate,
    [draft.description, draft.title, reviewContext, tickets]
  );
  const reviewInsights = useMemo(
    () => buildTicketReviewInsights({ draft, context: reviewContext, momenceSummary, duplicateTicket }),
    [draft, duplicateTicket, momenceSummary, reviewContext]
  );
  const duplicatePatternInsights = useMemo(() => buildDuplicatePatternInsights({
    id: '__draft__',
    title: draft.title,
    description: draft.description,
    category: draft.category,
    subCategory: draft.subCategory,
    priority: draft.priority,
    status: 'New',
    studio: draft.studio,
    trainer: draft.trainer || undefined,
    classType: draft.classType || undefined,
    classDateTime: draft.classDateTime || undefined,
    memberName: draft.memberName || undefined,
    memberContact: draft.memberContact || undefined,
    reportedBy: draft.reportedBy || undefined,
    assignedTo: draft.assignedTo || 'Unassigned',
    team: draft.department || 'Management',
    tags: draft.tags,
    createdAt: new Date(0).toISOString(),
    slaDueAt: new Date(0).toISOString(),
    sentiment: draft.sentiment as Ticket['sentiment'] | undefined,
  }, tickets.filter((ticket) => !isTrainerEvaluationProfileOnly(ticket))), [draft, tickets]);

  return (
    <TicketPreviewCard
      draft={draft}
      onConfirm={onConfirm}
      onEdit={onEdit}
      onDiscard={onDiscard}
      onSaveEdit={onSaveEdit}
      confirmed={confirmed}
      ticketId={ticketId}
      confirmedTicket={confirmedTicket}
      publishing={publishing}
      reviewInsights={reviewInsights}
      duplicatePatternInsights={duplicatePatternInsights}
      momenceLoading={momenceLoading}
      momenceError={momenceError}
    />
  );
};

const TypingIndicator: React.FC = () => (
  <div className="animate-p57-fade-up flex items-end gap-2">
    <div className="h-8 w-8 rounded-full overflow-hidden bg-gradient-to-br from-blue-100 to-indigo-100 border-2 border-blue-200 flex-shrink-0 p-0.5 shadow-sm">
      <img src="/download-1.png" alt="Athena" className="-scale-x-100 w-full h-full rounded-full object-cover" />
    </div>
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-blue-100/70 border-l-[3px] border-l-blue-400/60 bg-gradient-to-br from-white to-blue-50/50 px-4 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-typing" style={{ animationDelay: '0s' }} />
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-typing" style={{ animationDelay: '0.2s' }} />
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-typing" style={{ animationDelay: '0.4s' }} />
      </div>
      <span className="pl-1 text-[11px] font-medium text-slate-400">Athena is thinking…</span>
    </div>
  </div>
);

const TrainerAvatar: React.FC<{ name: string; src?: string; size?: 'sm' | 'lg' }> = ({ name, src, size = 'sm' }) => {
  const dimension = size === 'lg' ? 'h-16 w-16 text-sm' : 'h-6 w-6 text-[9px]';
  return (
    <span className={`${dimension} flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-blue-100 bg-blue-50 font-bold text-blue-700`}>
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        trainerInitials(name)
      )}
    </span>
  );
};

const InstructorEvaluationChatbox: React.FC<{
  onSubmit: (evaluation: TrainerEvaluationInput) => void | Promise<void>;
  disabled?: boolean;
}> = ({ onSubmit, disabled }) => {
  const [template, setTemplate] = useState<TrainerReviewTemplate>('Barre');
  const [instructor, setInstructor] = useState('');
  const [studio, setStudio] = useState('');
  const [classType, setClassType] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [reviewPeriod, setReviewPeriod] = useState('');
  const [scores, setScores] = useState<TrainerEvaluationScore[]>(
    TRAINER_REVIEW_TEMPLATES.Barre.map((item) => ({ ...item, score: 0 }))
  );
  const [feedback, setFeedback] = useState('');
  const [focusPoints, setFocusPoints] = useState('');
  const [goals, setGoals] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showScoring, setShowScoring] = useState(false);
  const [trainerMenuOpen, setTrainerMenuOpen] = useState(false);
  const selectedTrainerImage = trainerImageUrl(instructor);

  const totalScore = scores.reduce((sum, item) => sum + item.score, 0);
  const totalWeightage = scores.reduce((sum, item) => sum + item.weightage, 0);
  const scorePercent = totalWeightage ? Math.round((totalScore / totalWeightage) * 100) : 0;

  const athenaPrompts = [
    !instructor ? 'Instructor name helps Athena update the right profile.' : '',
    !studio ? 'Studio context improves trend reporting.' : '',
    !scores.some((item) => item.score > 0) ? 'Use sliders when score weightage is available.' : '',
    !feedback.trim() ? 'Evaluator comments will make the ticket richer.' : '',
  ].filter(Boolean);

  const applyTemplate = (nextTemplate: TrainerReviewTemplate) => {
    setTemplate(nextTemplate);
    setScores(TRAINER_REVIEW_TEMPLATES[nextTemplate].map((item) => ({ ...item, score: 0 })));
    setClassType('');
    setSessionId('');
  };

  const setScore = (category: string, score: number) => {
    setScores((current) => current.map((item) => (
      item.category === category
        ? { ...item, score: Math.max(0, Math.min(item.weightage, score)) }
        : item
    )));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        trainer: instructor.trim() || 'Unspecified Instructor',
        template,
        studio,
        classType,
        reviewPeriod,
        scores,
        feedback: feedback.trim() || 'Instructor evaluation submitted without evaluator notes.',
        focusPoints,
        goals,
      });
      setFeedback('');
      setFocusPoints('');
      setGoals('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full rounded-2xl border border-blue-100 bg-white/95 p-3 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
          <GraduationCap className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-950">Instructor evaluation</div>
          <div className="truncate text-[11px] text-slate-500">Optional fields · preview draft before publishing.</div>
        </div>
        </div>
        <div className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700">
          {scorePercent}% · {totalScore.toFixed(1)}/{totalWeightage}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        {(['Barre', 'PowerCycle', 'StrengthFit'] as TrainerReviewTemplate[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => applyTemplate(item)}
            className={`h-9 rounded-lg text-[11px] font-semibold transition ${
              template === item
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100'
                : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
            }`}
          >
            {item === 'StrengthFit' ? 'Strength/Fit' : item}
          </button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div className="relative">
          <button
            type="button"
            onClick={() => setTrainerMenuOpen((current) => !current)}
            className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 text-left text-[11px] font-semibold text-slate-900 outline-none transition hover:border-blue-200 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
          >
            <TrainerAvatar name={instructor || 'Instructor'} src={selectedTrainerImage} size="sm" />
            <span className="min-w-0 flex-1 truncate">{instructor || 'Instructor'}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${trainerMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {trainerMenuOpen && (
            <div className="absolute left-0 right-0 top-10 z-30 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_60px_rgba(15,23,42,0.16)]">
              <button
                type="button"
                onClick={() => {
                  setInstructor('');
                  setTrainerMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
              >
                <TrainerAvatar name="Instructor" size="sm" />
                <span>Instructor</span>
              </button>
              {TRAINERS.map((trainer) => (
                <button
                  key={trainer}
                  type="button"
                  onClick={() => {
                    setInstructor(trainer);
                    setTrainerMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs font-semibold transition ${
                    instructor === trainer ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <TrainerAvatar name={trainer} src={trainerImageUrl(trainer)} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{trainer}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <select
          value={studio}
          onChange={(event) => setStudio(event.target.value)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-900 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        >
          <option value="">Studio</option>
          {STUDIOS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <div className="md:col-span-2">
          <MomenceSessionDropdownField
            multi={false}
            sessionTypes={[]}
            values={{ sessionId, classType, classDateTime: reviewPeriod, trainer: instructor, studio }}
            onChange={(sessions) => {
              const session = sessions[0];
              setSessionId(session?.id || '');
              setClassType(session?.classType || '');
              setReviewPeriod(session?.startsAt || '');
              setInstructor(session?.trainer || instructor);
              setStudio(session?.studio || studio);
            }}
          />
        </div>
        <input
          value={reviewPeriod}
          onChange={(event) => setReviewPeriod(event.target.value)}
          placeholder="Review period notes"
          className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setShowScoring((current) => !current)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Weighted scoring</span>
            <span className="mt-0.5 block text-[10px] text-slate-500">{showScoring ? 'Hide scales' : 'Show scales and weightage'}</span>
          </span>
          <span className="rounded-full border border-blue-100 bg-white px-2 py-1 text-[10px] font-semibold text-blue-700">
            {scorePercent}% · {totalScore.toFixed(1)}/{totalWeightage}
          </span>
        </button>
        {showScoring && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {scores.map((item) => (
              <label key={item.category} className="block rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold leading-snug text-slate-700">{item.category}</span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{item.score.toFixed(1)} / {item.weightage}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={item.weightage}
                  step={0.5}
                  value={item.score}
                  onChange={(event) => setScore(item.category, Number(event.target.value))}
                  className="h-2 w-full accent-blue-600"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="Evaluator comments: client connection, cues, musicality, energy, choreography, hands-on corrections..."
          rows={4}
          className="min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
        />
        <div className="grid gap-2">
          <textarea
            value={focusPoints}
            onChange={(event) => setFocusPoints(event.target.value)}
            placeholder="Focus points"
            rows={2}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
          />
          <textarea
            value={goals}
            onChange={(event) => setGoals(event.target.value)}
            placeholder="Goals or next commitments"
            rows={2}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
          />
        </div>
      </div>

      {athenaPrompts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {athenaPrompts.slice(0, 3).map((question) => (
            <span key={question} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500">
              {question}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={disabled || submitting}
        className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)] transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
      >
        <Send className="h-3.5 w-3.5" />
        {submitting ? 'Preparing draft...' : 'Preview evaluation draft'}
      </button>
    </div>
  );
};

const PublishedTicketSummary: React.FC<{ ticketId: string; ticket?: Ticket }> = ({ ticketId, ticket }) => (
  <div className="mt-2 w-full max-w-xl overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.1)]">
    <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
      <CheckCircle2 className="h-4 w-4" />
      Ticket {ticketId} published
    </div>
    <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Live SLA clock</div>
        <p className="mt-1 text-xs text-slate-500">
          The countdown is now active in Submitted Tickets and every dashboard queue view.
        </p>
      </div>
      {ticket ? (
        <SlaCountdown slaDueAt={ticket.slaDueAt} status={ticket.status} className="justify-start" />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          Syncing SLA target
        </div>
      )}
    </div>
  </div>
);

const fieldHelpText = (field: DetailFormField): string => {
  const id = String(field.id);
  if (id === 'clientsAffected') return 'Confirm whether clients were impacted before publishing the ticket.';
  if (id === 'memberName' || id === 'memberContact') return 'Use Momence search where possible so the member record and contact stay consistent.';
  if (id === 'membership') return 'Choose the active package from Momence results when available, or from the standard membership list.';
  if (id === 'classType' || id === 'sessionId' || id === 'classDateTime' || id === 'trainer') return 'Choose the relevant class/session context for the member issue.';
  if (id === 'classImpactType') return 'Classify the class/session impact so routing and urgency are clear before asking for details.';
  if (id === 'classImpactDetails') return 'Capture exactly how the selected class/session changed, such as delay, pause, cancellation, relocation, or member response.';
  if (id === 'priority') return 'Choose the operational urgency. Safety, access and retention-risk issues should be High or Critical.';
  if (id === 'description') return 'Capture the concrete facts and what happened without adding subjective interpretation.';
  if (id === 'desiredResolution') return 'Document what the member asked Physique 57 to do next, including their preferred follow-up channel.';
  if (id === 'incidentDateTime') return 'Use the earliest known time the issue was noticed, reported, or experienced.';
  if (id === 'category' || id === 'subCategory') return 'Pick the closest routing category so ownership, analytics and SLA handling stay accurate.';
  if (id === 'intakeRoute') return 'Select the workflow this feedback belongs to; Athena uses this to shape the next ticket draft.';
  return field.required
    ? 'Required for clean routing and resolution without extra follow-up.'
    : 'Optional context that can help the owner resolve the ticket faster.';
};

const DetailCaptureForm: React.FC<{
  form: DetailForm;
  initialContext: DetailContext;
  disabled?: boolean;
  onSubmit: (values: Record<string, string>, form?: DetailForm) => void;
}> = ({ form, initialContext, disabled = false, onSubmit }) => {
  const toCsvList = (value?: string) =>
    (value || '')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
  const appendCsvUnique = (current: string | undefined, next: string) => {
    const existing = toCsvList(current);
    if (existing.some((item) => item.toLowerCase() === next.trim().toLowerCase())) return current || '';
    return [...existing, next.trim()].join(' | ');
  };
  const removeCsvItem = (current: string | undefined, target: string) =>
    toCsvList(current)
      .filter((item) => item.toLowerCase() !== target.toLowerCase())
      .join(' | ');
  const removeSelectedMember = (current: Record<string, string>, memberName: string) => {
    const names = toCsvList(current.memberName);
    const index = names.findIndex((item) => item.toLowerCase() === memberName.toLowerCase());
    if (index < 0) {
      return {
        ...current,
        memberName: removeCsvItem(current.memberName, memberName),
      };
    }
    const removeAtIndex = (value?: string) =>
      toCsvList(value)
        .filter((_, itemIndex) => itemIndex !== index)
        .join(' | ');
    return {
      ...current,
      memberId: removeAtIndex(current.memberId),
      memberName: removeAtIndex(current.memberName),
      memberContact: removeAtIndex(current.memberContact),
      membership: '',
    };
  };

  const initialValues = form.fields.reduce<Record<string, string>>((acc, field) => {
    const id = String(field.id);
    acc[id] = initialContext[id] || '';
    return acc;
  }, {});
  const fieldIds = new Set(form.fields.map((field) => String(field.id)));
  const shouldSeedMemberValues = MEMBER_ENTITY_KEYS.some((field) => fieldIds.has(field));
  const shouldSeedSessionValues = SESSION_ENTITY_KEYS.some((field) => fieldIds.has(field));
  const hiddenSeedKeys = [
    ...(shouldSeedMemberValues ? MEMBER_ENTITY_KEYS : []),
    ...(shouldSeedSessionValues ? [...SESSION_ENTITY_KEYS, 'studio'] : []),
  ];
  for (const key of hiddenSeedKeys) {
    if (initialContext[key]) initialValues[key] = initialContext[key] || '';
  }
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [hostMembershipOptions, setHostMembershipOptions] = useState<string[]>([]);
  const [membershipOptions, setMembershipOptions] = useState<string[]>([]);
  const [sessionBookings, setSessionBookings] = useState<MomenceSessionBooking[]>([]);
  const [sessionBookingsLoading, setSessionBookingsLoading] = useState(false);
  const [sessionBookingsError, setSessionBookingsError] = useState<string | null>(null);
  const isAssessmentForm = form.id === 'trainer-class-assessment';
  const hasMemberFields = form.fields.some((field) => field.id === 'memberName' || field.id === 'memberContact');
  const hasSessionFields = form.fields.some((field) => field.id === 'classType' || field.id === 'classDateTime' || field.id === 'sessionId');

  useEffect(() => {
    let cancelled = false;
    loadHostMembershipOptions()
      .then((options) => {
        if (!cancelled) {
          setHostMembershipOptions(options);
          setMembershipOptions((current) => current.length ? current : options);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHostMembershipOptions([]);
          setMembershipOptions((current) => current);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!values.memberId) {
      setMembershipOptions(hostMembershipOptions);
      return;
    }
    let cancelled = false;
    loadActiveMembershipOptions(values.memberId, hostMembershipOptions)
      .then((options) => {
        if (!cancelled) setMembershipOptions(options);
      })
      .catch(() => {
        if (!cancelled) setMembershipOptions(hostMembershipOptions);
      });
    return () => {
      cancelled = true;
    };
  }, [hostMembershipOptions, values.memberId]);

  useEffect(() => {
    const sessionId = splitPipeList(values.sessionId)[0];
    if (!sessionId || !hasMemberFields) {
      setSessionBookings([]);
      setSessionBookingsError(null);
      setSessionBookingsLoading(false);
      return;
    }
    let cancelled = false;
    setSessionBookingsLoading(true);
    setSessionBookingsError(null);
    getMomenceSessionBookings(sessionId)
      .then((bookings) => {
        if (!cancelled) setSessionBookings(bookings);
      })
      .catch((error) => {
        if (!cancelled) setSessionBookingsError(error instanceof Error ? error.message : 'Session member list failed to load');
      })
      .finally(() => {
        if (!cancelled) setSessionBookingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasMemberFields, values.sessionId]);

  const setValue = (id: string, value: string) => {
    setValues((current) => {
      const next = { ...current, [id]: value };
      if (id === 'category' && current.category !== value) next.subCategory = '';
      return next;
    });
  };

  const fieldVisible = (field: DetailFormField) => {
    if (!field.dependsOn) return true;
    return values[field.dependsOn] === field.dependsOnValue;
  };
  const visibleFields = form.fields.filter(fieldVisible);
  const ratingFields = visibleFields.filter((field) => field.type === 'rating' && field.scoreWeight);
  const weightedScore = ratingFields.reduce((sum, field) => {
    const rating = Number(values[field.id]);
    if (!Number.isFinite(rating)) return sum;
    return sum + (Math.max(0, Math.min(10, rating)) / 10) * (field.scoreWeight || 0);
  }, 0);
  const scoreOutOf100 = Math.round(weightedScore * 10) / 10;
  const canSubmit = visibleFields.every((field) => !field.required || values[String(field.id)]?.trim());
  const requiredFields = visibleFields.filter((field) => field.required);
  const completedRequired = requiredFields.filter((field) => values[String(field.id)]?.trim()).length;
  const completionPercent = requiredFields.length ? Math.round((completedRequired / requiredFields.length) * 100) : 100;
  const showTopSessionPicker = hasSessionFields && !isAssessmentForm;
  const startsSection = (field: DetailFormField, index: number) => {
    if (!field.section) return false;
    const previousVisible = form.fields
      .slice(0, index)
      .filter(fieldVisible)
      .filter((candidate) => !(isAssessmentForm && (candidate.id === 'studio' || candidate.id === 'trainer' || candidate.id === 'classDateTime')))
      .filter((candidate) => !(showTopSessionPicker && (candidate.id === 'classType' || candidate.id === 'classDateTime' || candidate.id === 'sessionId')))
      .at(-1);
    return previousVisible?.section !== field.section;
  };

  return (
    <form
      className="mt-3 w-full overflow-visible rounded-3xl border border-slate-200 bg-white/95 shadow-[0_26px_80px_rgba(15,23,42,0.12)] backdrop-blur"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !disabled) {
          const submissionValues = isAssessmentForm
            ? { ...values, evaluationScore: `${scoreOutOf100}/100` }
            : values;
          onSubmit(submissionValues, form);
        }
      }}
    >
      <div className="border-b border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50/45 px-5 py-4">
        <div className="grid gap-4 md:grid-cols-[1fr_220px] md:items-center">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-700 text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)]">
              <ClipboardCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-stone-950">{form.title}</h3>
              {form.description && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-stone-500">{form.description}</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-blue-700" />
                {isAssessmentForm ? 'Evaluation score' : 'Required complete'}
              </span>
              <span className="font-mono tabular-nums text-slate-900">
                {isAssessmentForm ? `${scoreOutOf100}/100` : `${completedRequired}/${requiredFields.length || 0}`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isAssessmentForm ? 'bg-gradient-to-r from-emerald-500 via-blue-600 to-indigo-600' : 'bg-blue-700'}`}
                style={{ width: `${isAssessmentForm ? Math.min(100, scoreOutOf100) : completionPercent}%` }}
              />
            </div>
            {isAssessmentForm && (
              <div className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <span>{completedRequired}/{requiredFields.length || 0} required</span>
                <span>{values.templateType || 'Select template'}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2">
        {showTopSessionPicker && (
          <MomenceSessionDropdownField
            values={values}
            multi={false}
            sessionTypes={initialContext.category === 'Hosted Class & Partnerships' ? HOSTED_CLASS_SESSION_TYPES : []}
            onChange={(sessions) => {
              setValues((current) => ({
                ...current,
                sessionId: sessions.map((session) => session.id).join(' | '),
                classType: sessions.map((session) => session.classType).join(' | '),
                classDateTime: sessions.map((session) => session.startsAt || '').filter(Boolean).join(' | '),
                scheduledStartTime: current.scheduledStartTime || toDateTimeLocalInputValue(sessions[0]?.startsAt),
                trainer: sessions.map((session) => session.trainer || '').filter(Boolean).join(' | '),
                studio: sessions.map((session) => session.studio || '').filter(Boolean).join(' | ') || current.studio || '',
              }));
            }}
          />
        )}
        {hasMemberFields && (
          sessionBookings.length > 0 || values.sessionId ? (
            <SessionBookingMemberField
              values={values}
              bookings={sessionBookings}
              loading={sessionBookingsLoading}
              error={sessionBookingsError}
              onSelect={(booking) => {
                const memberName = momenceBookingMemberName(booking);
                const memberId = booking.member?.id ? String(booking.member.id) : '';
                const memberContact = momenceBookingContact(booking);
                setValues((current) => ({
                  ...current,
                  memberId: memberId ? appendCsvUnique(current.memberId, memberId) : current.memberId || '',
                  memberName: appendCsvUnique(current.memberName, memberName),
                  memberContact: memberContact ? appendCsvUnique(current.memberContact, memberContact) : current.memberContact || '',
                  membership: current.membership || '',
                }));
              }}
              onRemove={(memberName) => {
                setValues((current) => removeSelectedMember(current, memberName));
              }}
            />
          ) : (
            <MomenceMemberFormField
              values={values}
              onSelect={async (member) => {
                setValues((current) => ({
                  ...current,
                  memberId: appendCsvUnique(current.memberId, member.id),
                  memberName: appendCsvUnique(current.memberName, member.name),
                  memberContact: appendCsvUnique(current.memberContact, member.email || member.phoneNumber || member.description || ''),
                  membership: current.membership || '',
                }));
              }}
              onRemove={(memberName) => {
                setValues((current) => removeSelectedMember(current, memberName));
              }}
            />
          )
        )}
        {form.fields.map((field, fieldIndex) => {
          const id = String(field.id);
          if (!fieldVisible(field)) return null;
          if (hasMemberFields && (id === 'memberName' || id === 'memberContact')) return null;
          if (isAssessmentForm && id === 'classType') {
            return (
              <AssessmentSessionDetailsField
                key={id}
                values={values}
                onChange={(nextValues) => setValues((current) => ({ ...current, ...nextValues }))}
              />
            );
          }
          if (isAssessmentForm && (id === 'studio' || id === 'trainer' || id === 'classDateTime')) return null;
          if (showTopSessionPicker && (id === 'classType' || id === 'classDateTime' || id === 'sessionId')) return null;
          const helpText = fieldHelpText(field);
          const complete = !field.required || Boolean(values[id]?.trim());
          const category = values.category;
          const options =
            field.id === 'subCategory' && category
              ? CATEGORIES[category] || []
              : field.id === 'subCategory'
                ? []
              : field.id === 'membership'
                ? withCurrentOption(membershipOptions, values.membership)
                : field.options || [];

          return (
            <div
              key={id}
              className={`group relative rounded-2xl border bg-white p-3 shadow-sm transition duration-200 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 ${
                complete ? 'border-slate-200' : 'border-blue-200'
              } ${field.type === 'textarea' || field.type === 'rating' ? 'md:col-span-2' : ''}`}
            >
              {startsSection(field, fieldIndex) && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-emerald-50 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-blue-700" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-900">{field.section}</span>
                  {field.scoreWeight ? <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">{field.scoreWeight} pts</span> : null}
                </div>
              )}
              <div className="mb-2 flex items-start justify-between gap-3">
                <label htmlFor={`detail-${id}`} className="flex min-w-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] ${
                    complete ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                  }`}>
                    {fieldIndex + 1}
                  </span>
                  <span className="min-w-0 truncate">
                    {field.label}
                    {field.required ? <span className="text-blue-600"> *</span> : ''}
                  </span>
                </label>
                <span className="group/help relative inline-flex shrink-0">
                  <HelpCircle className="h-4 w-4 text-slate-400 transition group-hover/help:text-blue-700" />
                  <span className="pointer-events-none absolute right-0 top-6 z-20 w-64 rounded-2xl border border-slate-200 bg-stone-950 px-3 py-2 text-[11px] font-medium leading-relaxed text-white opacity-0 shadow-2xl transition group-hover/help:opacity-100">
                    {helpText}
                  </span>
                </span>
              </div>
              {field.type === 'rating' ? (
                <RatingControl
                  id={`detail-${id}`}
                  value={values[id] || ''}
                  weight={field.scoreWeight || 0}
                  onChange={(nextValue) => setValue(id, nextValue)}
                />
              ) : field.type === 'select' ? (
                (() => {
                  const forceSingle = new Set([
                    'intakeRoute',
                    'category',
                    'subCategory',
                    'priority',
                    'templateType',
                    'classType',
                    'studio',
                    'trainer',
                    'reportedBy',
                    'memberSentiment',
                    'clientsAffected',
                    'classImpactType',
                    'membership',
                    'freezeReason',
                    'rolloverReason',
                    'hostedFeedbackArea',
                    'prospectQuality',
                    'followUpPreference',
                    'hvacSymptom',
                    'machineSymptom',
                    'bikeSymptom',
                    'equipmentSymptom',
                    'lockFaultType',
                    'accessStatus',
                    'securityRisk',
                    'resolutionRequirement',
                    'affectedArea',
                    'plumbingSymptom',
                    'electricalSymptom',
                    'appIssueSurface',
                  ]);
                  const isMulti = !forceSingle.has(field.id);
                  const disabledSelect = field.id === 'subCategory' && !values.category;
                  const useButtons = !isMulti && !disabledSelect && shouldUseOptionButtons({ id, optionCount: options.length });
                  return isMulti ? (
                    <MultiSelectDropdown
                      value={values[id] || ''}
                      options={options}
                      placeholder={
                        `Select ${field.label.toLowerCase()}`
                      }
                      disabled={disabledSelect}
                      onChange={(nextValue) => setValue(id, nextValue)}
                    />
                  ) : useButtons ? (
                    <OptionButtonGroup
                      id={`detail-${id}`}
                      label={field.label}
                      value={values[id] || ''}
                      options={options}
                      onChange={(nextValue) => setValue(id, nextValue)}
                    />
                  ) : (
                <select
                  id={`detail-${id}`}
                  value={values[id] || ''}
                  onChange={(event) => setValue(id, event.target.value)}
                  disabled={disabledSelect}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-stone-900 outline-none transition hover:bg-white focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                >
                  <option value="">
                    {field.id === 'subCategory' && !values.category
                        ? 'Select category first'
                      : `Select ${field.label.toLowerCase()}`}
                  </option>
                  {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                  );
                })()
              ) : field.type === 'textarea' ? (
                <>
                  <textarea
                    id={`detail-${id}`}
                    value={values[id] || ''}
                    onChange={(event) => setValue(id, event.target.value)}
                    rows={4}
                    className="min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-stone-900 outline-none transition hover:bg-white focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                    placeholder={field.placeholder || 'Describe the issue and relevant details...'}
                  />
                  <SuggestionChips suggestions={suggestionsForDetailField(field)} onPick={(suggestion) => setValue(id, suggestion)} />
                </>
              ) : (
                <>
                  <input
                    id={`detail-${id}`}
                    type={field.type === 'date' || field.type === 'datetime-local' || field.type === 'number' ? field.type : 'text'}
                    value={values[id] || ''}
                    onChange={(event) => setValue(id, event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-stone-900 outline-none transition hover:bg-white focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                    placeholder={field.placeholder || field.label}
                  />
                  {field.type === 'text' && (
                    <SuggestionChips suggestions={suggestionsForDetailField(field)} onPick={(suggestion) => setValue(id, suggestion)} />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[11px] text-stone-500">
          {completedRequired} of {requiredFields.length} required fields complete
        </span>
        <button
          type="submit"
          disabled={!canSubmit || disabled}
          className="rounded-xl bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {form.submitLabel || 'Continue'}
        </button>
      </div>
    </form>
  );
};

const AssessmentSessionDetailsField: React.FC<{
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}> = ({ values, onChange }) => {
  return (
    <div className="md:col-span-2 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-900">Session Details</div>
          <p className="mt-1 text-xs text-slate-500">
            Select the Momence session first so class, studio, instructor and start time map automatically.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold text-blue-800 ring-1 ring-blue-100">
          Momence mapped
        </span>
      </div>

      <MomenceSessionDropdownField
        values={values}
        multi={false}
        onChange={(sessions) => {
          onChange({
            sessionId: sessions.map((session) => session.id).join(' | '),
            classType: sessions.map((session) => session.classType).join(' | '),
            classDateTime: sessions.map((session) => session.startsAt || '').filter(Boolean).join(' | '),
            trainer: sessions.map((session) => session.trainer || '').filter(Boolean).join(' | '),
            studio: sessions.map((session) => session.studio || '').filter(Boolean).join(' | '),
          });
        }}
      />
    </div>
  );
};

const RatingControl: React.FC<{
  id: string;
  value: string;
  weight: number;
  onChange: (value: string) => void;
}> = ({ id, value, weight, onChange }) => {
  const rating = Number(value);
  const contribution = Number.isFinite(rating) ? Math.round((Math.max(0, Math.min(10, rating)) / 10) * weight * 10) / 10 : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-600">
        <span>Rating scale</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-slate-800 ring-1 ring-slate-200">
          {value || '0'}/10 = {contribution}/{weight}
        </span>
      </div>
      <div id={id} className="grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, score) => (
          <button
            key={score}
            type="button"
            onClick={() => onChange(String(score))}
            className={`h-8 rounded-lg text-xs font-semibold transition ${
              value === String(score)
                ? 'bg-blue-700 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-blue-50 hover:text-blue-800'
            }`}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
};

const OptionButtonGroup: React.FC<{
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}> = ({ id, label, value, options, onChange }) => (
  <div id={id} role="group" aria-label={label} className="flex flex-wrap gap-2">
    {options.map((option) => {
      const selected = value === option;
      return (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`min-h-10 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-500/15 ${
            selected
              ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
              : 'border-slate-200 bg-slate-50 text-stone-700 hover:border-blue-200 hover:bg-white'
          }`}
          aria-pressed={selected}
        >
          {option}
        </button>
      );
    })}
  </div>
);

const MultiSelectDropdown: React.FC<{
  value: string;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  onChange: (value: string) => void;
}> = ({ value, options, placeholder, disabled = false, loading = false, emptyMessage = 'No options available', onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedValues = useMemo(
    () => value.split('|').map((item) => item.trim()).filter(Boolean),
    [value]
  );
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const updateValues = (nextValues: string[]) => {
    onChange(nextValues.join(' | '));
  };

  const toggleOption = (option: string) => {
    if (selectedSet.has(option)) {
      updateValues(selectedValues.filter((item) => item !== option));
      return;
    }
    updateValues([...selectedValues, option]);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-stone-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selectedValues.length ? selectedValues.slice(0, 3).map((item) => (
            <span
              key={item}
              className="max-w-[180px] truncate rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800"
            >
              {item}
            </span>
          )) : (
            <span className="truncate text-slate-400">{placeholder}</span>
          )}
          {selectedValues.length > 3 && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              +{selectedValues.length - 3}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.14)]">
          {options.length ? options.map((option) => {
            const selected = selectedSet.has(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleOption(option)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                  selected ? 'bg-blue-50 text-blue-900' : 'text-stone-700 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {selected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 break-words">{option}</span>
              </button>
            );
          }) : loading ? (
            <div className="px-2.5 py-2 text-xs text-slate-500">Loading options...</div>
          ) : (
            <div className="px-2.5 py-2 text-xs text-slate-400">{emptyMessage}</div>
          )}
        </div>
      )}
    </div>
  );
};

function formatMembershipOption(membership: MomenceMembership): string {
  const name = membership.membership?.name || membership.type || `Membership #${membership.id}`;
  const credits =
    membership.eventCreditsLeft != null
      ? `${membership.eventCreditsLeft} credits left`
      : membership.usedSessions != null && membership.usageLimitForSessions != null
        ? `${Math.max(membership.usageLimitForSessions - membership.usedSessions, 0)} sessions left`
        : '';
  const endDate = membership.endDate
    ? `ends ${new Date(membership.endDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
    : '';
  return [name, credits, endDate].filter(Boolean).join(' · ');
}

function uniqueOptions(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function withCurrentOption(options: string[], current?: string): string[] {
  return uniqueOptions([...(current ? [current] : []), ...options]);
}

let hostMembershipOptionsCache: string[] | null = null;

async function loadHostMembershipOptions(): Promise<string[]> {
  if (hostMembershipOptionsCache) return hostMembershipOptionsCache;
  hostMembershipOptionsCache = await listMomenceHostMembershipOptions();
  return hostMembershipOptionsCache;
}

async function loadActiveMembershipOptions(memberId: string, hostMembershipOptions: string[] = []): Promise<string[]> {
  const memberships = await getMomenceMemberMemberships(memberId);
  const activeMembershipOptions = memberships
    .filter((membership) => !membership.isFrozen)
    .map(formatMembershipOption);
  return uniqueOptions([...activeMembershipOptions, ...hostMembershipOptions]);
}

const momenceSessionSearchCache = new Map<string, MomenceSessionOption[]>();

function momenceSessionDropdownCacheKey(sessionTypes: string[]): string {
  return `__momence_session_dropdown_options__:${sessionTypes.join(',')}`;
}

function mergeMomenceSessionOptions(currentOptions: MomenceSessionOption[], nextOptions: MomenceSessionOption[]): MomenceSessionOption[] {
  const byLabel = new Map<string, MomenceSessionOption>();
  for (const option of currentOptions) byLabel.set(momenceSessionDropdownLabel(option), option);
  for (const option of nextOptions) byLabel.set(momenceSessionDropdownLabel(option), option);
  return Array.from(byLabel.values());
}

const MomenceMemberFormField: React.FC<{
  values: Record<string, string>;
  onSelect: (member: MomenceMemberOption) => void | Promise<void>;
  onRemove: (memberName: string) => void;
}> = ({ values, onSelect, onRemove }) => {
  const [query, setQuery] = useState(values.memberName || values.memberContact || '');
  const [options, setOptions] = useState<MomenceMemberOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState(values.memberId || '');
  const isAffectedClientSelection = hasConfirmedAffectedClients(values.clientsAffected);

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      if (selectedMemberId && query === values.memberName) {
        setOptions([]);
        return;
      }
      if (query.trim().length < 2) {
        setOptions([]);
        return;
      }
      try {
        setError(null);
        setOptions(await searchMomenceMembers(query));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Member search failed');
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, selectedMemberId, values.memberName]);

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white p-3.5 transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 md:col-span-2">
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        {isAffectedClientSelection ? 'Affected Momence Clients' : 'Momence Member'} *
      </span>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
        placeholder="Search Momence by client name, email, or phone"
      />
      {error && <div className="mt-1 text-[11px] text-red-600">{error}</div>}
      {values.memberName && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.memberName.split('|').map((member) => member.trim()).filter(Boolean).map((member) => (
            <button
              key={member}
              type="button"
              onClick={() => onRemove(member)}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800"
              title="Remove member"
            >
              {member}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.1)]">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={async () => {
                setSelectedMemberId(option.id);
                setOptions([]);
                setQuery(option.label);
                await onSelect(option);
                setOptions([]);
              }}
              className="block w-full border-b border-stone-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-slate-50"
            >
              <div className="font-semibold text-stone-900">{option.label}</div>
              <div className="mt-0.5 text-[11px] text-stone-500">{option.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SessionBookingMemberField: React.FC<{
  values: Record<string, string>;
  bookings: MomenceSessionBooking[];
  loading?: boolean;
  error?: string | null;
  onSelect: (booking: MomenceSessionBooking) => void;
  onRemove: (memberName: string) => void;
}> = ({ values, bookings, loading = false, error = null, onSelect, onRemove }) => {
  const selectedMembers = splitPipeList(values.memberName);
  const selectedSet = new Set(selectedMembers.map((member) => member.toLowerCase()));
  const activeBookings = bookings.filter((booking) => !booking.cancelledAt && booking.member);

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white p-3.5 transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 md:col-span-2">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        Select members booked into this Momence session *
      </span>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        Member choices are mapped from the selected session bookings. Use this before falling back to a global member search.
      </p>
      {selectedMembers.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedMembers.map((member) => (
            <button
              key={member}
              type="button"
              onClick={() => onRemove(member)}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800"
              title="Remove member"
            >
              {member}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Loading session members...</div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : activeBookings.length ? (
        <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-1.5 sm:grid-cols-2">
          {activeBookings.map((booking) => {
            const memberName = momenceBookingMemberName(booking);
            const selected = selectedSet.has(memberName.toLowerCase());
            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => onSelect(booking)}
                className={`rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                  selected
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50'
                }`}
              >
                <div className="font-semibold">{memberName}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{momenceBookingContact(booking) || hostedBookingStatus(booking)}</div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No active bookings were returned for the selected session.
        </div>
      )}
    </div>
  );
};

function splitPipeList(value?: string): string[] {
  return (value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function momenceSessionDropdownLabel(session: MomenceSessionOption): string {
  return [session.label, session.description].filter(Boolean).join(' · ');
}

const MomenceSessionDropdownField: React.FC<{
  values: Record<string, string>;
  onChange: (sessions: MomenceSessionOption[]) => void | Promise<void>;
  multi?: boolean;
  sessionTypes?: string[];
}> = ({ values, onChange, multi = true, sessionTypes = [] }) => {
  const [options, setOptions] = useState<MomenceSessionOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheKey = useMemo(() => momenceSessionDropdownCacheKey(sessionTypes), [sessionTypes]);

  const optionLabelMap = useMemo(() => {
    const labelMap = new Map<string, MomenceSessionOption>();
    options.forEach((session) => labelMap.set(momenceSessionDropdownLabel(session), session));
    return labelMap;
  }, [options]);

  const selectedDropdownLabels = useMemo(() => {
    const selectedIds = splitPipeList(values.sessionId);
    if (selectedIds.length > 0 && options.length > 0) {
      const byId = new Map(options.map((session) => [session.id, session]));
      return selectedIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((session) => momenceSessionDropdownLabel(session as MomenceSessionOption));
    }
    return splitPipeList(values.classType);
  }, [options, values.classType, values.sessionId]);

  useEffect(() => {
    let cancelled = false;
    const cached = momenceSessionSearchCache.get(cacheKey);
    if (cached) {
      setOptions(cached);
      return;
    }

    setOptions([]);
    setLoading(true);
    setError(null);
    loadMomenceSessionsProgressively('', { types: sessionTypes }, (sessions) => {
      if (!cancelled) setOptions((current) => mergeMomenceSessionOptions(current, sessions));
    })
      .then((sessions) => {
        momenceSessionSearchCache.set(cacheKey, sessions);
        if (!cancelled) setOptions(sessions);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Session options failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, sessionTypes]);

  const handleDropdownChange = (nextValue: string) => {
    const requestedLabels = splitPipeList(nextValue);
    const finalLabels = multi
      ? requestedLabels
      : (() => {
          const added = requestedLabels.find((label) => !selectedDropdownLabels.includes(label));
          return added ? [added] : [];
        })();
    const selectedSessions = finalLabels
      .map((label) => optionLabelMap.get(label))
      .filter(Boolean) as MomenceSessionOption[];

    void onChange(selectedSessions);
  };

  const dropdownOptions = options.map(momenceSessionDropdownLabel);
  const dropdownValue = selectedDropdownLabels.join(' | ');
  const placeholder = loading
    ? dropdownOptions.length === 0
      ? 'Loading first Momence sessions...'
      : 'Select Momence sessions'
    : error
      ? 'Momence sessions unavailable'
      : multi
        ? 'Select Momence sessions'
        : 'Select Momence session';

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white p-3.5 transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 md:col-span-2">
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        Momence Class / Session *
      </span>
      <MultiSelectDropdown
        value={dropdownValue}
        options={dropdownOptions}
        placeholder={placeholder}
        loading={loading && dropdownOptions.length === 0}
        emptyMessage="No Momence sessions loaded yet"
        onChange={handleDropdownChange}
      />
      {error && <div className="mt-1 text-[11px] text-red-600">{error}</div>}
      {loading && (
        <div className="mt-1 text-[11px] text-slate-500">
          {dropdownOptions.length ? 'First sessions ready. Loading more in the background...' : 'Loading Momence sessions...'}
        </div>
      )}
    </div>
  );
};
