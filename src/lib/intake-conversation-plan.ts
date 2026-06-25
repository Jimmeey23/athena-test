import type { IntakeContext } from './intake-rules';

type ConversationFieldType = 'select' | 'text' | 'textarea' | 'date' | 'datetime-local' | 'number' | 'rating';

export interface ConversationPlanField {
  id: string;
  label: string;
  type: ConversationFieldType;
  options?: string[];
  required?: boolean;
}

interface BuildPlanInput {
  initialText: string;
  context?: IntakeContext;
  reporterName?: string;
}

export interface ConversationPlanStep {
  id: string;
  title: string;
  fieldIds: string[];
  reason: string;
}

export interface IntakeConversationPlan {
  reporterFirstName?: string;
  initialSignal: string;
  openingTone: string;
  followUpFieldIds: string[];
  steps: ConversationPlanStep[];
}

interface NaturalPromptInput {
  field: ConversationPlanField;
  reporterFirstName?: string;
}

function titleCase(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : value;
}

export function getReporterFirstName(name?: string | null): string | undefined {
  const value = (name || '').trim();
  if (!value || /^authenticated user$/i.test(value)) return undefined;

  const candidate = value.includes('@')
    ? value.split('@')[0].split(/[._-]/)[0]
    : value.split(/\s+/)[0];

  const cleaned = candidate.replace(/[^a-zA-Z]/g, '');
  return cleaned ? titleCase(cleaned) : undefined;
}

function hasConfirmedAffectedClients(value?: string): boolean {
  return /^yes\b/i.test(value?.trim() || '');
}

function hasClassAffectedSignal(value: string): boolean {
  return /\b(?:classes?|sessions?|schedule)\b.{0,36}\b(?:affected|impacted|delayed|paused|cancelled|canceled|moved|disrupted)\b/i.test(value)
    || /\b(?:affected|impacted|delayed|paused|cancelled|canceled|moved|disrupted)\b.{0,36}\b(?:classes?|sessions?|schedule)\b/i.test(value)
    || /\bclass flow\b|\bfull class\b|\bhad to pause\b|\bmembers?\s+stepped out\b|\bwalked out\b/i.test(value);
}

function hasClientImpactSignal(value: string): boolean {
  return /\b(member|client|customer|guest|prospect|attendee|lead|complain|complaint|said|reported|requested|felt|uncomfortable|walked out|class|session|booking)\b/i.test(value);
}

function compactSignal(text: string): string {
  const value = text.replace(/\s+/g, ' ').trim();
  if (value.length <= 180) return value;
  return `${value.slice(0, 177).trimEnd()}...`;
}

export function buildIntakeConversationPlan({
  initialText,
  context = {},
  reporterName,
}: BuildPlanInput): IntakeConversationPlan {
  const reporterFirstName = getReporterFirstName(reporterName);
  const combined = [
    initialText,
    context.initialReport,
    context.description,
    context.operationalImpact,
    context.currentWorkaround,
    context.classImpactType,
    context.classImpactDetails,
  ].filter(Boolean).join(' ');
  const followUpFieldIds = new Set<string>();
  const steps: ConversationPlanStep[] = [];

  steps.push({
    id: 'understand-report',
    title: 'Acknowledge the report and infer route/category/priority',
    fieldIds: ['intakeRoute', 'category', 'subCategory', 'priority'],
    reason: 'Start from the staff member details instead of route-first form selection.',
  });

  if (hasConfirmedAffectedClients(context.clientsAffected)) {
    followUpFieldIds.add('memberName');
    steps.push({
      id: 'affected-members',
      title: 'Identify affected member(s)',
      fieldIds: ['memberName'],
      reason: 'Confirmed client impact needs Momence member context before drafting.',
    });
  } else if (hasClientImpactSignal(combined)) {
    followUpFieldIds.add('clientsAffected');
    steps.push({
      id: 'confirm-client-impact',
      title: 'Confirm whether any members were directly or indirectly affected',
      fieldIds: ['clientsAffected'],
      reason: 'Report contains client/member signal — check client impact before drafting.',
    });
    steps.push({
      id: 'conditional-affected-members',
      title: 'If client impact is confirmed, identify affected member(s)',
      fieldIds: ['memberName'],
      reason: 'Client impact may change the required Momence follow-up path.',
    });
  }

  if (hasClassAffectedSignal(combined)) {
    followUpFieldIds.add('classType');
    followUpFieldIds.add('classImpactType');
    followUpFieldIds.add('classImpactDetails');
    steps.push({
      id: 'affected-session',
      title: 'Identify affected class/session',
      fieldIds: ['classType'],
      reason: 'The report says a class or schedule was affected.',
    });
    steps.push({
      id: 'session-impact',
      title: 'Capture how the class/session was affected',
      fieldIds: ['classImpactType', 'classImpactDetails'],
      reason: 'The owner needs to know whether the session was delayed, paused, moved, cancelled, or otherwise disrupted.',
    });
  }

  steps.push({
    id: 'draft-review',
    title: 'Draft only after required context is complete',
    fieldIds: [],
    reason: 'Keep the chat conversational while preserving publish-ready ticket quality.',
  });

  return {
    reporterFirstName,
    initialSignal: compactSignal(initialText),
    openingTone: reporterFirstName
      ? `${reporterFirstName}, I'll keep this conversational and ask only for the missing details.`
      : "I'll keep this conversational and ask only for the missing details.",
    followUpFieldIds: Array.from(followUpFieldIds),
    steps,
  };
}

export function serializeConversationPlan(plan: IntakeConversationPlan): string {
  return [
    `Opening tone: ${plan.openingTone}`,
    plan.initialSignal ? `Initial report signal: ${plan.initialSignal}` : '',
    'Planned flow:',
    ...plan.steps.map((step, index) => (
      `${index + 1}. ${step.title}${step.fieldIds.length ? ` [${step.fieldIds.join(', ')}]` : ''} - ${step.reason}`
    )),
  ].filter(Boolean).join('\n');
}

export function limitConversationalFieldBatch<T extends { id: string }>(fields: T[], maxFields = 2): T[] {
  const clientImpactField = fields.find((field) => field.id === 'clientsAffected');
  if (clientImpactField) return [clientImpactField];
  const resolutionRequiredField = fields.find((field) => field.id === 'resolutionRequired');
  if (resolutionRequiredField && fields.length === 1) return [resolutionRequiredField];
  const fieldsBeforeResolutionGate = resolutionRequiredField
    ? fields.filter((field) => field.id !== 'resolutionRequired')
    : fields;
  return fieldsBeforeResolutionGate.slice(0, Math.max(1, maxFields));
}

function questionFromLabel(label: string): string {
  const cleaned = label.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Can you share that detail?';
  return cleaned.endsWith('?') ? cleaned.charAt(0).toLowerCase() + cleaned.slice(1) : `${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}?`;
}

export function buildNaturalSingleFieldPrompt({ field, reporterFirstName }: NaturalPromptInput): string {
  const prefix = reporterFirstName ? `${reporterFirstName}, ` : '';

  if (field.id === 'memberName') {
    return `${prefix}which affected member(s) should I link from Momence?`;
  }
  if (field.id === 'classType' || field.id === 'sessionId') {
    return `${prefix}which class/session was affected?`;
  }
  if (field.id === 'classImpactDetails') {
    return `${prefix}what changed for the affected class/session? For example, was it delayed, paused, moved, cancelled, or did members share a specific concern?`;
  }
  if (field.id === 'classImpactType') {
    return `${prefix}what kind of class/session impact was reported?`;
  }
  if (field.id === 'description') {
    return `${prefix}what did the member or team report in their own words?`;
  }
  if (field.id === 'desiredResolution') {
    return `${prefix}what resolution or follow-up did the member ask for?`;
  }
  if (field.id === 'incidentDateTime') {
    return `${prefix}when did this happen or first get noticed?`;
  }
  if (field.id === 'resolutionRequired') {
    return `${prefix}Does this ticket require a resolution?`;
  }

  if (field.type === 'select') return `${prefix}${questionFromLabel(field.label)}`;
  return `${prefix}please share ${field.label.toLowerCase()}.`;
}
