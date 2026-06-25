import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { callJsonAi, type AiProvider } from '../_shared/ai-provider.ts';
import { buildGuardFieldDefinition, getGuardFieldType } from '../_shared/intake-fields.ts';
import { buildKnowledgeSearchText, embedKnowledgeText, formatKnowledgeContext, type KnowledgeChunk } from '../_shared/knowledge-base.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

type DraftTicket = {
  title: string;
  description: string;
  category: string;
  subCategory: string;
  priority: Priority;
  studio: string;
  trainer?: string | null;
  classType?: string | null;
  classDateTime?: string | null;
  memberName?: string | null;
  memberContact?: string | null;
  reportedBy?: string | null;
  tags?: string[];
  sentiment?: string | null;
  conversationSummary?: string | null;
  assignedTo?: string | null;
  department?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type RequestBody = {
  action?: 'draftTicket' | 'createTicket' | 'generateReportNarrative';
  approved?: boolean;
  draftOnly?: boolean;
  instructions?: string;
  debugTrace?: boolean;
  draft?: DraftTicket;
  ticket?: DraftTicket;
  messages?: ChatMessage[];
  conversationId?: string | null;
  context?: Record<string, unknown>;
  intakeContract?: Record<string, unknown>;
  masterData?: Record<string, unknown>;
  promptProfile?: string;
  reportId?: string;
  period?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  metrics?: Array<Record<string, unknown>>;
  topRows?: Array<Record<string, unknown>>;
  sections?: Array<Record<string, unknown>>;
  dataQualityNotes?: string[];
  assumptions?: string[];
  aiProvider?: AiProvider;
  embeddingProvider?: 'openai' | 'deepseek' | 'auto';
};

// Authoritative Athena prompt. The frontend sends a compact prompt profile, not prompt text.
const ATHENA_SYSTEM_PROMPT = `
You are Athena — Physique 57 India's internal AI operations assistant. You're warm, sharp, and efficient. You help staff log tickets quickly and accurately, so the right person can act without chasing down details.

YOUR GOAL: Turn a staff member's initial report into a complete, actionable ticket — one the assigned owner can resolve immediately without a single follow-up question.

HOW TO DECIDE WHAT TO ASK:
Read the initial report carefully. Ask yourself: what does the person resolving this ticket actually need to know?
Think from the owner's perspective — what is the exact fault or situation, where, when did it start, what is the impact right now, what constraints exist, and what outcome is expected?
Identify only what's missing from the initial report. Plan the full conversational flow mentally, then ask the next 1-2 most valuable questions.

Do not use a fixed list of fields. Reason about this specific incident and decide what gaps exist.
For example: a broken door at the studio entrance raises different questions than one in the locker room — one has overnight security implications, the other does not. A washing machine not draining needs different questions than one that won't turn on. A trainer late to a 7am class has different urgency than one late to a 7pm class. Always think contextually.

You are NOT limited to canonical/master-data fields. You are expected to add the incident-specific questions an owner would need. Build the form from what THIS incident requires — invent targeted snake_case fields freely for anything that isn't a canonical field.
Worked example — "Instructor arrived late for the barre class". A good intake does NOT stop at studio + member. Plan and ask the gaps that actually let an owner act and close the loop:
- which session and its scheduled start time (use classType for the Momence session picker), and how late the instructor was;
- whether advance notice was given, and if so how far ahead;
- the reason for the late arrival;
- how members reacted — were they upset, did anyone leave, was the class shortened or delayed;
- whether service recovery or a member-facing follow-up is expected, and the requested outcome.
Apply the same depth to every incident family: capture cause, timing, impact, and expected outcome — not just identifiers. Ask the 1-2 highest-value gaps per turn until the picture is complete, then draft.

IMPORTANT — for physical, maintenance, or facility issues:
Never use 'description' as a field ID. Generate specific, targeted field IDs describing exactly what you're asking (e.g. latch_fault_type, door_access_status, water_source, machine_symptom, security_concern, resolution_approach). Collect the full operational picture — fault specifics, current access or safety implications, expected resolution — over short 1-2 question turns. Do not produce a generic description box; produce questions whose answers let the assigned owner act immediately.

FORM DESIGN RULES:
- Be warm, human, and reassuring — especially when staff report urgent or distressing issues. Match their tone and energy level.
- If the user only greets you or uses small talk, respond naturally and warmly. Ask what they want to log. Do not open a ticket form from a greeting.
- Use plain operational language: member, client, studio, class/session, instructor, category, issue type. Avoid heavy brand lingo unless quoting source data.
- Prefer structured controls over plain text. If the answer can be chosen from known options, constants, statuses, priorities, categories, studios, instructors, class impact types, sentiment, yes/no, resolution status, affected clients, request types, or follow-up preferences, use type "select" with options. Do not ask those as free text.
- For a single bounded select question, return it as suggestedChips with the same field/value options so the frontend shows button options instead of a text box. Use detailForm only when multiple fields are needed or a picker/date/number/textarea is needed.
- Keep each intake turn lightweight: prefer 1-2 grouped, high-signal questions. Add extra required fields only when the owner truly cannot act without them.
- Field labels must describe exactly what you're asking, specific to this incident — never generic.
- For bounded answer spaces, use select with options tailored to the situation. Options should be concise operational labels, not long paragraphs.
- For dates, use date. For timestamps or session/incident timing, use datetime-local. For counts, durations, minutes late, amounts, or numeric quantities, use number. Never ask constants, dates, times, counts, or amounts through a plain text field.
- Use text only for genuinely unknown names/references that do not have a picker. Use textarea only for open narrative context such as reason, observed issue detail, or member wording that cannot be captured by options.
- Field IDs must be snake_case and self-describing (e.g. door_fault_type, current_access_situation).
- Never ask for reportedBy — the frontend supplies it from the signed-in user.
- FIELD TYPE ENFORCEMENT (critical): Never use type "text" for: (a) any date or time — use "date" or "datetime-local"; (b) any field with a bounded set of options — use "select" with options array; (c) studio location — use "select" with the known studio list from master data. A text input for date or location will render as a plain text box with no picker — this is always wrong.
- DO NOT ASK IRRELEVANT QUESTIONS: Before adding any field, ask: "Would the ticket owner be unable to resolve or route this ticket without this answer?" If no, omit the field. Never ask for studio/location if the report is not studio-specific. Never ask for date/time if the incident is not time-sensitive. Never ask for member details on internal/facility issues unless a member is directly involved.
- If staff seem stressed or describe something urgent, acknowledge it briefly before asking the next question.

WHEN TO DRAFT IMMEDIATELY vs WHEN TO ASK FIRST:
Draft immediately only if the initial report already contains everything the assigned owner needs.
If any of the following is missing — exact nature of the fault, timing, operational impact, or resolution needed — collect it first.
A one-sentence report is rarely enough to draft from. Probe before drafting.

INTAKE INFERENCE:
- Infer exactly one intake route: Request, Complaint, Feedback, or Internal Reporting
- Infer the best category and subcategory from approved master data — do not require manual selection
- Infer priority with a short urgency reason
- Always populate inferredContext with category, subCategory, intakeRoute, and priority once inferred, even while asking for more details

ENTITY FIELDS — memberName, memberContact, classType, classDateTime, trainer, sessionId, membership:
These fields refer to specific Momence records. Use them when the user's message or current context makes the record useful for resolving the ticket.
Do not apply a physical-vs-member checklist. A facility issue, class issue, billing issue, or feedback note may or may not need entity context depending on what the staff member actually reported.
When unsure, ask the most natural clarifying question rather than forcing a generic picker.

MEMBER COMMERCIAL / CLASS-ACCESS INCIDENTS:
For commercial, refund, billing, membership, class-entry, and policy-dispute reports, reason from the current issue rather than a fixed verification checklist.
Do not automatically ask for Momence purchase/payment context, membership, studio, incident date, or sentiment. Ask for one of those only when the current ticket cannot be routed or resolved without it.
Use existing canonical fields when they are genuinely relevant: memberName for a named/identifiable member, membership for a specific package decision, classType for a specific session dispute, desiredResolution for an unclear requested outcome, and momencePurchaseContext only when payment/purchase evidence is central to the decision.
For issue-specific gaps such as "reason for refund", "policy communication received", or "resolution already offered", create targeted snake_case fields rather than a generic description field.
Do not hardcode member names, studio names, instructors, package names, or response scripts. Ask only for context that is missing from the current conversation, selected Momence context, or the draft itself.

ROUTING AND MASTER DATA:
- Use only approved master-data values for studios, trainers, class types, categories, subcategories, priorities, and associates
- Use provided routingRules, employees, departments, and locations as authoritative — never invent names, escalation paths, or SLAs
- Member and class/session fields must use Momence-powered UI pickers, not plain text inputs

DYNAMIC INTAKE:
- Do not follow a fixed checklist. Ask only the next question that is useful for the specific report.
- Ask about affected clients, members, sessions, packages, resolution requirement, or follow-up only when the user's message makes that context relevant.
- If the initial report is already clear enough to route and act on, draft immediately instead of collecting generic fields.
- If context is missing, ask 1-2 specific questions that resolve the most important ambiguity.

ANTI-LOOP RULE (CRITICAL — read before every response):
- Look at the last assistant message. If it asked a conversational question (not a detailForm), and the user has replied with anything at all, that question is ANSWERED. Accept the reply, move on. Never re-ask a question from a previous assistant turn.
- Do NOT ask for "member's own words", "verbatim report", or any rewording of the same concept. The complaint is already visible in the conversation history — quote it directly in the ticket description. Never generate a field or question asking for this.
- If a user gives a short or imperfect answer to your previous question (e.g. "wants refund", "music loud", "too cold"), accept it. Do not ask again. Synthesise the answer into your draft.
- Never ask the same logical question twice under any wording variation.

CONVERSATION STYLE:
- Ask one natural question at a time when only one field is missing. Do not describe it as a form — just ask naturally.
- Keep replies warm, friendly, and concise. Staff are busy; be efficient but human.
- Use context.reporterFirstName naturally — especially in greetings, transitions, or when asking for something important. Don't repeat their name in every single message.
- Use one relevant emoji occasionally when it feels natural. Never in formal ticket titles, descriptions, field values, report copy, IDs, emails, or records.
- When staff describe something that sounds stressful or serious (a member walked out, an injury, a safety issue), acknowledge it first with a brief human response ("That sounds stressful — let me help you log this properly.") before diving into questions.
- When wrapping up intake before drafting, give a brief reassuring summary of what you've captured so staff feel confident before reviewing the draft.

TICKET QUALITY:
- Title: specific operational summary — name the exact item, area, studio, or person involved. Never generic like "Maintenance issue" or "Member complaint".
- Description: factual, third-person internal language. What was reported, what the impact is, what resolution is expected.
- Never paste the user's raw message into the description. Remove salutations/sign-offs and summarize the operational facts cleanly.
- Use "Internal report summary" for Internal Reporting. Use "Member feedback summary" only when a member/client actually gave feedback.
- Do not include stale multi-value context (multiple studios, instructors, or sessions) unless the user explicitly selected multiple affected records.
- Priority: Critical for safety or access risk; High for service failure affecting live classes; Medium for operational issues; Low for cosmetic or deferred items.
- Every published draft must include ticket.metadata.recommendedResolutionSteps with 4-6 concise owner action steps. The steps MUST reference the concrete details captured in this conversation — the actual fault, person, session, time, cause, and requested outcome. Name them. Generic placeholders are forbidden: never write "Confirm the exact studio space, tool, or environmental condition", "Route to the studio owner with the affected session and member impact", "Close the loop with the member once the issue is checked", or any step that would read identically for an unrelated ticket. A reviewer must be able to tell which ticket the steps belong to from the wording alone. Include Momence verification only when member/session/package data is actually involved. Order them as the owner would actually work the ticket.
- Ticket creation happens only after explicit user approval of the displayed draft.
`.trim();

type AiDetailField = {
  id: string;
  label: string;
  type: 'select' | 'text' | 'textarea' | 'date' | 'datetime-local' | 'number';
  required?: boolean;
  options?: string[];
  dependsOn?: string;
};

type AiDetailForm = {
  title: string;
  description?: string;
  fields: AiDetailField[];
  submitLabel?: string;
};

type AiIntakeResponse = {
  needsMoreInfo: boolean;
  reply: string;
  detailForm?: AiDetailForm | null;
  ticket?: DraftTicket | null;
  suggestedChips?: Array<{ label: string; value: string; field: string }>;
  inferredContext?: Record<string, string>;
  missingFields?: string[];
  publishable?: boolean;
  urgencyReason?: string;
  debugTrace?: Record<string, unknown> | null;
  provider?: string;
  model?: string;
};

type IntakeDecisionTrace = {
  traceId: string;
  conversationId: string;
  promptProfile: string;
  requestedDebug: boolean;
  path: 'greeting' | 'ai-dynamic' | 'fallback-regex' | 'incomplete-regex' | 'drafted-regex';
  provider?: string;
  model?: string;
  rawIssueText: string;
  effectiveContext: Record<string, unknown>;
  ai: {
    present: boolean;
    needsMoreInfo?: boolean;
    publishable?: boolean;
    reply?: string;
    detailFormFieldIds: string[];
    missingFields: string[];
    ticketPresent: boolean;
  };
  guard: {
    guardedMissingFields: string[];
    finalDetailFormFieldIds: string[];
    remainingMissingFields: string[];
  };
  final: {
    needsMoreInfo: boolean;
    publishable: boolean;
    ticketPresent: boolean;
    detailFormFieldIds: string[];
  };
  decisionSteps: string[];
};

type DetailFieldId =
  | 'intakeRoute'
  | 'requestType'
  | 'clientsAffected'
  | 'studio'
  | 'category'
  | 'subCategory'
  | 'trainer'
  | 'classType'
  | 'membership'
  | 'memberName'
  | 'memberContact'
  | 'reportedBy'
  | 'priority'
  | 'description'
  | 'desiredResolution'
  | 'resolutionRequired'
  | 'incidentDateTime'
  | 'memberSentiment'
  | 'momencePurchaseContext'
  | 'classImpactType'
  | 'classImpactDetails'
  | 'freezeStartDate'
  | 'freezeEndDate'
  | 'freezeReason'
  | 'classesRemaining'
  | 'packageExpiryDate'
  | 'requestedRolloverDate'
  | 'rolloverReason'
  | 'partnerName'
  | 'hostedFeedbackArea'
  | 'attendeeCount'
  | 'prospectQuality'
  | 'followUpPreference'
  | 'machineSymptom'
  | 'bikeSymptom'
  | 'equipmentSymptom'
  | 'hvacSymptom'
  | 'lockFaultType'
  | 'accessStatus'
  | 'securityRisk'
  | 'plumbingSymptom'
  | 'electricalSymptom'
  | 'affectedArea'
  | 'operationalImpact'
  | 'currentWorkaround'
  | 'resolutionRequirement'
  | 'appIssueSurface'
  | 'appErrorObserved'
  | 'deviceContext';

const PRIORITY_SLA_HOURS: Record<Priority, number> = {
  Critical: 2,
  High: 8,
  Medium: 24,
  Low: 72,
};

const PLACEHOLDER_VALUE_PATTERN = /unspecified|not specified|member-reported issue|ai intake|authenticated user/i;
const HVAC_TEXT_PATTERN = /\b(?:ac|hvac)\b|air\s?con|air conditioning|not cooling|not heating|no airflow/i;
const CLIENTS_AFFECTED_OPTIONS = [
  'Yes - directly affected',
  'Yes - indirectly affected',
  'Yes - directly and indirectly affected',
  'No clients affected',
  'Not confirmed yet',
];
const CLASS_IMPACT_TYPE_OPTIONS = [
  'Delayed start',
  'Paused during session',
  'Cancelled',
  'Moved to another space',
  'Shortened session',
  'Capacity or comfort issue',
  'Member left early',
  'Other impact',
];
const RECORD_ONLY_ASSIGNEE = 'Unassigned';
const DEPARTMENTS = [
  'Management',
  'Marketing & PR',
  'Sales & Client Servicing',
  'Training & Client Experience',
  'Operations & Maintenance',
  'Accounts & Finance',
  'Technical Support',
];

function normalizeDepartmentName(department?: string | null): string {
  const normalized = String(department || '').trim().toLowerCase();
  if (!normalized) return 'Management';
  if (normalized === 'marketing' || normalized === 'marketing & pr') return 'Marketing & PR';
  if (normalized === 'training' || normalized === 'training & client experience') return 'Training & Client Experience';
  if (normalized === 'operations' || normalized === 'operations & maintenance') return 'Operations & Maintenance';
  if (normalized === 'accounts' || normalized === 'finance' || normalized === 'accounts & finance') return 'Accounts & Finance';
  if (normalized === 'technical support' || normalized === 'tech support') return 'Technical Support';
  if (normalized === 'customer service' || normalized === 'client servicing' || normalized === 'sales & client servicing') return 'Sales & Client Servicing';
  return DEPARTMENTS.find((item) => item.toLowerCase() === normalized) || department || 'Management';
}

const CATEGORY_SUBCATEGORIES: Record<string, string[]> = {
  Scheduling: ['Time Change', 'Level Change', 'Additional Classes', 'Trainer Preferences', 'Class Capacity Issues', 'Waitlist Concerns', 'Studio Timings', 'Cancellation Policy', 'Booking Restrictions', 'Class Substitutions', 'Trainer Substitutions', 'Last-minute Cancellations', 'Late Arrival Policy', 'Booking Confirmation Issues', 'Rescheduling Flexibility'],
  'Class Experience': ['Bad Odour', 'Audio Issues', 'Studio Temperature Too Hot/Cold', 'Overcrowding in Class', 'Class Flow and Pacing', 'Modifications in Routine', 'Engagement with Clients', 'Hands-on Adjustments', 'Demonstration and Visual Cues', 'Knowledge and Competence', 'Instructor Energy and Motivation', 'Class Variety and Themes'],
  'Trainer Feedback': ['Trainer Forgot Names', 'Class Intensity Too High/Low', 'Trainer Hygiene', 'Trainer Punctuality Issues', 'Trainer Behaviour', 'Modifications in Routine', 'Engagement with Clients', 'Hands-on Adjustments', 'Demonstration and Visual Cues', 'Knowledge and Competence', 'Brand Language Usage', 'Pre and Post-Class Outreach', 'Trainer Availability', 'Feedback Handling', 'Trainer Encouragement', 'Too Many Corrections vs. Too Few'],
  'Repair and Maintenance': ['AC and HVAC Issues', 'Lighting Issues', 'Audio System Malfunction', 'Pest Control Needed', 'Plumbing Leaks', 'General Maintenance Delays', 'Door Lock Issues', 'Fire Safety Compliance', 'Water Dispenser Issues', 'Broken Equipment', 'TFA Malfunction', 'Staff Uniforms Not Clean', 'Toiletries and Supplies Low', 'Towel Availability Issues'],
  'Studio Amenities and Facilities': ['Studio Odour and Aroma', 'Cleanliness and Hygiene', 'Ventilation Poor', 'Air Quality Poor', 'Valet Issues', 'Locker Availability', 'Shower Water Pressure', 'Steam Room Not Working', 'Boutique Availability Issues', 'Wi-Fi Slow', 'Lost and Found Disorganization'],
  'Operating Systems': ['Momence Issues', 'Stripe and Razorpay', 'Website Glitches', 'Router Connectivity', 'iPad Functionality', 'POS System Malfunctions', 'Payment Gateway Issue', 'Technical Assistance'],
  'Pricing and Memberships': ['Membership Pause and Freeze Policy', 'Refund and Cancellation Policy Issue', 'Membership Upgrade/Downgrade', 'Class Pack Expiry Confusion', 'Late Cancellation Fee Dispute', 'Complimentary Class Request', 'Trial Class Conversion', 'Package Renewal', 'Credit/Rollover Request'],
  'Customer Service and Communication': ['Delay in Response', 'Staff Behaviour', 'WhatsApp Follow-up Missed', 'Email Not Responded', 'Front Desk Issue', 'Member Not Informed', 'Communication Gap'],
  'Safety and Security': ['Theft Prevention Measures', 'Harassment Reports', 'Personal Safety Concerns', 'Security Breach', 'Emergency Incident'],
  'Hosted Class & Partnerships': ['Hosted Class Feedback', 'Prospect Conversion Opportunity', 'Partner Instructor Feedback', 'Lead Quality Note', 'Guestlist Issue', 'Collaboration Request'],
  'App & Digital': ['App Crash', 'Login Issue', 'Push Notifications', 'Payment Gateway Issue', 'Momence Account Sync', 'Booking Confirmation Missing', 'Website Chat / Lead Form Issue'],
  'Sales & Consultation': ['Competitor Mentioned', 'Prospect Price Concern', 'Lead Quality Note', 'Trial Conversion', 'Drop-in Query'],
  'Brand Feedback': ['Brand Language Usage', 'Marketing Feedback', 'Social Media Feedback', 'Event Feedback'],
  'Member Progress & Transformation': ['Injury Concern', 'Goal Setting', 'Progress Tracking', 'Modification Request', 'Return from Injury'],
  'Theft and Lost Items': ['Lost Item', 'Stolen Item', 'Found Item', 'Locker Break-in'],
  'General Feedback': ['Compliment', 'Suggestion', 'General Comment', 'Other'],
  'Facility & Equipment': ['Broken Equipment', 'Bike / Cycle Issue', 'Monitor Malfunction', 'Barre Equipment', 'Props and Accessories', 'AC and HVAC Issues', 'Plumbing Leaks', 'Lighting Issues', 'Door Lock Issues', 'General Maintenance'],
  'Billing & Membership': ['Refund Request', 'Membership Freeze', 'Rollover Request', 'Package Expiry', 'Late Cancellation Fee', 'Upgrade / Downgrade', 'Credit Request', 'Billing Dispute'],
  'Booking & Schedule': ['Class Availability', 'Waitlist Issue', 'Booking Confirmation', 'Rescheduling', 'Late Arrival', 'Cancellation Policy', 'Trainer Substitution'],
  'Instructor & Class Quality': ['Class Flow', 'Instructor Energy', 'Engagement', 'Modifications', 'Hands-on Adjustments', 'Intensity Level', 'Knowledge and Cues'],
  'Front Desk & Service': ['Staff Behaviour', 'Delay in Response', 'Communication Gap', 'Check-in Issue', 'Member Not Informed'],
  'Safety & Medical': ['Injury on Premises', 'Medical Emergency', 'First Aid Required', 'Unsafe Equipment', 'Security Breach'],
};

const ASSIGNMENT_RULES: Record<string, { assignedTo: string; team: string }> = {
  Scheduling: { assignedTo: 'Akshay Rane', team: 'Sales & Client Servicing' },
  'Class Experience': { assignedTo: 'Anisha Shah', team: 'Training & Client Experience' },
  'Trainer Feedback': { assignedTo: 'Anisha Shah', team: 'Training & Client Experience' },
  'Repair and Maintenance': { assignedTo: 'Zahur Shaikh', team: 'Operations & Maintenance' },
  'Studio Amenities and Facilities': { assignedTo: 'Zahur Shaikh', team: 'Operations & Maintenance' },
  'Operating Systems': { assignedTo: 'Saachi Shetty - Operations', team: 'Technical Support' },
  'Tech Issues': { assignedTo: 'Saachi Shetty - Operations', team: 'Technical Support' },
  'Pricing and Memberships': { assignedTo: 'Akshay Rane', team: 'Sales & Client Servicing' },
  'Customer Service and Communication': { assignedTo: 'Nunu Yeptomi', team: 'Sales & Client Servicing' },
  'Brand Feedback': { assignedTo: 'Saachi Shetty', team: 'Marketing & PR' },
  'Safety and Security': { assignedTo: 'Saachi Shetty - Operations', team: 'Operations & Maintenance' },
  'Theft and Lost Items': { assignedTo: 'Zahur Shaikh', team: 'Operations & Maintenance' },
  Miscellaneous: { assignedTo: 'Nunu Yeptomi', team: 'Management' },
  'Instructor & Class Quality': { assignedTo: 'Anisha Shah', team: 'Training & Client Experience' },
  'Booking & Schedule': { assignedTo: 'Akshay Rane', team: 'Sales & Client Servicing' },
  'Facility & Equipment': { assignedTo: 'Zahur Shaikh', team: 'Operations & Maintenance' },
  'Billing & Membership': { assignedTo: 'Akshay Rane', team: 'Sales & Client Servicing' },
  'Safety & Medical': { assignedTo: 'Saachi Shetty - Operations', team: 'Operations & Maintenance' },
  'Front Desk & Service': { assignedTo: 'Nunu Yeptomi', team: 'Sales & Client Servicing' },
  'App & Digital': { assignedTo: 'Saachi Shetty - Operations', team: 'Technical Support' },
  'Hosted Class & Partnerships': { assignedTo: 'Saachi Shetty', team: 'Marketing & PR' },
  'Member Progress & Transformation': { assignedTo: 'Anisha Shah', team: 'Training & Client Experience' },
  'Sales & Consultation': { assignedTo: 'Jimmeey Gondaa', team: 'Sales & Client Servicing' },
  'General Feedback': { assignedTo: 'Nunu Yeptomi', team: 'Management' },
};
const REFUND_CATEGORIES = ['Billing & Membership', 'Pricing and Memberships'];
const SERVER_MASTER_DATA = {
  routes: ['Request', 'Complaint', 'Feedback', 'Internal Reporting'],
  studios: [
    'Kwality House, Kemps Corner',
    'Supreme HQ, Bandra',
    'Kenkere House, Bengaluru',
    'Courtside, Mumbai',
    'the Studio by Copper & Cloves, Bengaluru',
  ],
  categories: Object.keys(ASSIGNMENT_RULES),
  categorySubcategories: CATEGORY_SUBCATEGORIES,
  departments: DEPARTMENTS,
  priorities: Object.keys(PRIORITY_SLA_HOURS),
  clientsAffectedOptions: CLIENTS_AFFECTED_OPTIONS,
  classImpactTypeOptions: CLASS_IMPACT_TYPE_OPTIONS,
};

function isBengaluruStudio(studio?: string | null): boolean {
  return /bengaluru|bangalore|copper/i.test(studio || '');
}

function isBandraStudio(studio?: string | null): boolean {
  return /bandra|supreme/i.test(studio || '');
}

function isRefundRouting(category: string, subCategory?: string | null): boolean {
  return REFUND_CATEGORIES.includes(category) && /refund/i.test(subCategory || '');
}

function resolveSalesAssignment(studio?: string | null): { assignedTo: string; team: string } {
  if (isBengaluruStudio(studio)) return { assignedTo: 'Yashas K', team: 'Sales & Client Servicing' };
  if (isBandraStudio(studio)) return { assignedTo: 'Imran Shaikh', team: 'Sales & Client Servicing' };
  return { assignedTo: 'Akshay Rane', team: 'Sales & Client Servicing' };
}

function resolveAssignment(category: string, studio?: string | null, subCategory?: string | null): { assignedTo: string; team: string } {
  if (isRefundRouting(category, subCategory)) return resolveSalesAssignment(studio);

  if (['Scheduling', 'Booking & Schedule', 'Front Desk & Service', 'Customer Service and Communication', 'Sales & Consultation', 'Billing & Membership', 'Pricing and Memberships'].includes(category)) {
    return resolveSalesAssignment(studio);
  }

  if (['Facility & Equipment', 'Repair and Maintenance', 'Studio Amenities and Facilities', 'Safety and Security', 'Safety & Medical', 'Theft and Lost Items', 'Operating Systems', 'Tech Issues', 'App & Digital'].includes(category)) {
    if (['Operating Systems', 'Tech Issues', 'App & Digital'].includes(category)) {
      return { assignedTo: 'Saachi Shetty - Operations', team: 'Technical Support' };
    }
    return isBengaluruStudio(studio)
      ? { assignedTo: 'Shifa Ali', team: 'Operations & Maintenance' }
      : { assignedTo: 'Zahur Shaikh', team: 'Operations & Maintenance' };
  }

  return ASSIGNMENT_RULES[category] || ASSIGNMENT_RULES['General Feedback'];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function bearerToken(authorization: string): string {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function authenticateRequest(request: Request): Promise<Response | { user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } }> {
  const supabaseUrl = Deno.env.get('TICKETING_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('TICKETING_SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json({ error: 'Missing Supabase auth configuration' }, 500);

  const token = bearerToken(request.headers.get('authorization') || '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return json({ error: 'Unauthorized' }, 401);

  return { user: data.user };
}

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isCasualGreeting(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  const greetingPattern = /^(hi|hello|hey|heya|hiya|good\s+(morning|afternoon|evening)|namaste|yo)(\s+athena)?[.!?\s]*$/i;
  const issueSignalPattern = /\b(ac|hvac|broken|not working|issue|problem|complaint|member|client|refund|billing|payment|class|session|trainer|instructor|studio|booking|schedule|maintenance|repair|leak|dirty|urgent)\b/i;
  if (issueSignalPattern.test(value) && !greetingPattern.test(value)) return false;
  return greetingPattern.test(value);
}

function normalizePriority(value: unknown): Priority {
  if (value === 'Critical' || value === 'High' || value === 'Medium' || value === 'Low') return value;
  return 'Medium';
}

function hasConfirmedAffectedClients(value: unknown): boolean {
  return /^yes\b/i.test(cleanString(value));
}


function computeSlaDueAt(priority: Priority): string {
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + PRIORITY_SLA_HOURS[priority]);
  return dueAt.toISOString();
}

function ticketRequiresResolution(context: Record<string, unknown>): boolean {
  return cleanString(context.resolutionRequired).toLowerCase() !== 'no';
}

function ticketSlug(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function shouldUseMemberContext(issueText: string, context: Record<string, unknown>, category = '', subCategory = ''): boolean {
  const value = [
    issueText,
    category,
    subCategory,
    cleanString(context.requestType),
    cleanString(context.clientsAffected),
  ].filter(Boolean).join(' ').toLowerCase();

  if (hasConfirmedAffectedClients(context.clientsAffected)) return true;
  return /member|client|customer|guest|prospect|profile|contact|phone|email|membership|package|billing|payment|refund|freeze|roll\s?over|extension|renewal|follow-up/.test(value);
}

function shouldUseSessionContext(issueText: string, context: Record<string, unknown>, category = '', subCategory = ''): boolean {
  const value = [
    issueText,
    category,
    subCategory,
    cleanString(context.requestType),
  ].filter(Boolean).join(' ').toLowerCase();

  return /class|session|booking|schedul|waitlist|attendance|attendee|trainer|instructor|barre|cycle|powercycle|strength|late cancellation|no-show/.test(value);
}

function professionalDescription(text: string, context: Record<string, unknown>, category: string, subCategory: string): string {
  const route = cleanString(context.intakeRoute, 'Unclassified');
  const includeMemberContext = shouldUseMemberContext(text, context, category, subCategory);
  const includeSessionContext = shouldUseSessionContext(text, context, category, subCategory);
  const member = includeMemberContext ? cleanString(context.memberName) : '';
  const studio = cleanString(context.studio);
  const trainer = includeSessionContext ? cleanString(context.trainer) : '';
  const classType = includeSessionContext ? cleanString(context.classType) : '';
  const membership = includeMemberContext ? cleanString(context.membership) : '';
  const clientsAffected = cleanString(context.clientsAffected);
  const resolution = cleanString(context.desiredResolution);
  const incidentDateTime = cleanString(context.incidentDateTime);

  return [
    `Summary: ${text || 'The report requires internal follow-up.'}`,
    '',
    'Operational context:',
    `- Intake route: ${route}`,
    `- Category: ${category} / ${subCategory}`,
    clientsAffected ? `- Client impact check: ${clientsAffected}` : null,
    member ? `- Member: ${member}` : null,
    studio ? `- Studio: ${studio}` : null,
    trainer ? `- Instructor: ${trainer}` : null,
    classType ? `- Class/session: ${classType}` : null,
    incidentDateTime ? `- Approx. incident date/time: ${incidentDateTime}` : null,
    membership ? `- Active package/membership: ${membership}` : null,
    '',
    `Requested resolution: ${resolution || 'Resolution pathway to be confirmed by the assigned owner after review.'}`,
    '',
    'Athena review note: Ticket was drafted from internal intake details and should be validated before operational action.',
  ].filter((line) => line !== null).join('\n');
}

function fallbackDraft(messages: ChatMessage[] = [], context: Record<string, unknown> = {}): DraftTicket {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
  const text = cleanString(context.description) || latestUserMessage.replace(/\[Context[^\n]*\]\n?/i, '').trim();
  const lower = text.toLowerCase();
  let inferredCategory = 'General Feedback';
  if (/billing|refund|payment|freeze|roll over|rollover|extension|membership|package/.test(lower)) {
    inferredCategory = 'Pricing and Memberships';
  } else if (/hosted|partner|influencer/.test(lower)) {
    inferredCategory = 'Hosted Class & Partnerships';
  } else if (/injury|safety|medical|security|theft|stolen|missing cash|harass/.test(lower)) {
    inferredCategory = 'Safety and Security';
  } else if (/repair|maintenance|broken|not working|not closing|not opening|stopped working|won't close|won't open|malfunction|faulty|damaged|leak|leaking|plumbing|drain|clog|flush|machine|washing|dryer|pump|electrical|socket|bulb|pest|mold|mould|crack|\bdoor\b|\block\b|handle|hinge/.test(lower) || HVAC_TEXT_PATTERN.test(lower)) {
    inferredCategory = 'Repair and Maintenance';
  } else if (/odour|odor|smell|ventilation|air quality|locker|shower|washroom|steam|clean|dirty|hygiene|temperature|too hot|too cold|air\s?con|amenity/.test(lower)) {
    inferredCategory = 'Studio Amenities and Facilities';
  } else if (/trainer|instructor|class/.test(lower)) {
    inferredCategory = 'Class Experience';
  }
  const category = cleanString(context.category, inferredCategory);

  const priority: Priority =
    normalizePriority(context.priority || (category === 'Safety and Security' || category === 'Safety & Medical' ? 'Critical' : lower.includes('angry') || lower.includes('urgent') ? 'High' : 'Medium'));

  const subCategory = cleanString(context.subCategory, category === 'General Feedback' ? 'Other' : 'Member-reported issue');
  const includeMemberContext = shouldUseMemberContext(text, context, category, subCategory);
  const includeSessionContext = shouldUseSessionContext(text, context, category, subCategory);
  const titleParts = [
    cleanString(context.intakeRoute, 'Ticket'),
    subCategory,
    includeMemberContext ? cleanString(context.memberName) : '',
  ].filter(Boolean);

  return {
    title: titleParts.join(' · ').slice(0, 96) || 'Issue requiring follow-up',
    description: professionalDescription(text, context, category, subCategory),
    category,
    subCategory,
    priority,
    studio: cleanString(context.studio, 'Unspecified Studio'),
    trainer: includeSessionContext ? cleanString(context.trainer) || null : null,
    classType: includeSessionContext ? cleanString(context.classType) || null : null,
    classDateTime: includeSessionContext ? cleanString(context.classDateTime) || null : null,
    memberName: includeMemberContext ? cleanString(context.memberName) || null : null,
    memberContact: includeMemberContext ? cleanString(context.memberContact) || null : null,
    reportedBy: cleanString(context.reportedBy, 'AI Intake') || null,
    tags: [
      'ai-draft',
      ticketSlug(context.intakeRoute),
      ticketSlug(category),
      ticketSlug(subCategory),
      ticketSlug(context.requestType),
    ].filter(Boolean),
    sentiment: lower.includes('angry') || lower.includes('frustrated') ? 'Negative' : 'Neutral',
    conversationSummary: text,
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function normalizeAiDetailForm(value: unknown): AiDetailForm | null {
  if (!value || typeof value !== 'object') return null;
  const form = value as Partial<AiDetailForm> & { fields?: unknown[] };
  const allowedTypes = new Set(['select', 'text', 'textarea', 'date', 'datetime-local', 'number']);
  const fields = (Array.isArray(form.fields) ? form.fields : [])
    .map((field) => {
      if (!field || typeof field !== 'object') return null;
      const raw = field as Partial<AiDetailField>;
      const id = cleanString(raw.id).replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 80);
      const label = cleanString(raw.label);
      const type = allowedTypes.has(cleanString(raw.type)) ? raw.type as AiDetailField['type'] : 'text';
      if (!id || !label) return null;
      return {
        id,
        label,
        type,
        required: raw.required !== false,
        options: Array.isArray(raw.options) ? raw.options.map(String).filter(Boolean).slice(0, 30) : undefined,
        dependsOn: cleanString(raw.dependsOn) || undefined,
      };
    })
    .filter(Boolean) as AiDetailField[];

  if (!fields.length) return null;
  return {
    title: cleanString(form.title, 'Complete ticket intake details'),
    description: cleanString(form.description),
    fields,
    submitLabel: cleanString(form.submitLabel, 'Continue drafting ticket'),
  };
}

function normalizeAiIntakeResponse(value: Record<string, unknown> | null): AiIntakeResponse | null {
  if (!value) return null;
  const detailForm = normalizeAiDetailForm(value.detailForm);
  const ticket = value.ticket && typeof value.ticket === 'object'
    ? withRecommendedResolutionMetadata(value.ticket as DraftTicket)
    : null;
  return {
    needsMoreInfo: Boolean(value.needsMoreInfo || detailForm),
    reply: cleanString(value.reply, detailForm ? 'Please complete the structured intake form below.' : 'I drafted the ticket below. Please review it before publishing.'),
    detailForm,
    ticket,
    suggestedChips: Array.isArray(value.suggestedChips) ? value.suggestedChips as AiIntakeResponse['suggestedChips'] : [],
    inferredContext: value.inferredContext && typeof value.inferredContext === 'object'
      ? value.inferredContext as Record<string, string>
      : {},
    missingFields: Array.isArray(value.missingFields) ? value.missingFields.map(String) : [],
    publishable: typeof value.publishable === 'boolean' ? value.publishable : !(value.needsMoreInfo || detailForm),
    urgencyReason: cleanString(value.urgencyReason),
  };
}

function detailFormFieldIds(form?: AiDetailForm | null): string[] {
  return (form?.fields || []).map((field) => field.id);
}

function buildDecisionTrace(input: {
  traceId: string;
  conversationId: string;
  promptProfile: string;
  requestedDebug: boolean;
  path: 'greeting' | 'ai-dynamic' | 'fallback-regex' | 'incomplete-regex' | 'drafted-regex';
  provider?: string;
  model?: string;
  rawIssueText: string;
  effectiveContext: Record<string, unknown>;
  aiResponse?: AiIntakeResponse | null;
  guardedMissingFields?: string[];
  finalForm?: AiDetailForm | null;
  remainingMissingFields?: string[];
  finalNeedsMoreInfo: boolean;
  finalPublishable: boolean;
  finalTicketPresent: boolean;
}): IntakeDecisionTrace {
  const aiResponse = input.aiResponse;
  const aiDetailFormFieldIds = detailFormFieldIds(aiResponse?.detailForm);
  const finalDetailFormFieldIds = detailFormFieldIds(input.finalForm);
  const guardedMissingFields = input.guardedMissingFields || [];
  const remainingMissingFields = input.remainingMissingFields || [];
  const decisionSteps = [
    input.path === 'ai-dynamic' && aiResponse ? 'AI returned a structured intake response.' : 'AI was not used for this branch; regex logic handled the intake.',
    aiResponse?.detailForm ? `AI proposed ${aiDetailFormFieldIds.length} detail field(s).` : 'AI did not propose a detail form.',
    guardedMissingFields.length ? `Deterministic guard still required: ${guardedMissingFields.join(', ')}.` : 'Deterministic guard found no missing required fields.',
    input.finalForm ? `Final form contains ${finalDetailFormFieldIds.length} field(s) after normalization.` : 'Final form was not needed.',
    input.finalNeedsMoreInfo ? 'Athena asked for more details before drafting.' : 'Athena considered the draft ready to return.',
    input.finalTicketPresent ? 'A draft ticket was returned.' : 'No draft ticket was returned yet.',
  ];

  return {
    traceId: input.traceId,
    conversationId: input.conversationId,
    promptProfile: input.promptProfile,
    requestedDebug: input.requestedDebug,
    path: input.path,
    provider: input.provider,
    model: input.model,
    rawIssueText: input.rawIssueText,
    effectiveContext: input.effectiveContext,
    ai: {
      present: Boolean(aiResponse),
      needsMoreInfo: aiResponse?.needsMoreInfo,
      publishable: aiResponse?.publishable,
      reply: aiResponse?.reply,
      detailFormFieldIds: aiDetailFormFieldIds,
      missingFields: aiResponse?.missingFields || [],
      ticketPresent: Boolean(aiResponse?.ticket),
    },
    guard: {
      guardedMissingFields,
      finalDetailFormFieldIds,
      remainingMissingFields,
    },
    final: {
      needsMoreInfo: input.finalNeedsMoreInfo,
      publishable: input.finalPublishable,
      ticketPresent: input.finalTicketPresent,
      detailFormFieldIds: finalDetailFormFieldIds,
    },
    decisionSteps,
  };
}

function logDecisionTrace(trace: IntakeDecisionTrace): void {
  console.log('[athena-intake-trace]', JSON.stringify(trace));
}

/**
 * Scans the conversation history to find fields that were asked by the assistant
 * and answered by the user in free text. Returns a set of field IDs considered
 * "conversationally answered" so the guard doesn't re-add them to the form.
 *
 * Strategy: if the previous assistant turn contained a conversational question
 * referencing a field concept, and the user replied with any non-trivial text,
 * treat that field as answered. This prevents the anti-loop rule from being
 * undermined by the deterministic guard.
 */
function extractConversationallyAnsweredFields(
  messages: ChatMessage[],
  context: Record<string, unknown>,
): Set<string> {
  const answered = new Set<string>();
  // Fields already in context are answered by definition
  const CHECKABLE: Array<[string, RegExp]> = [
    ['studio', /which studio|what studio|which location|which branch|studio location/i],
    ['trainer', /which (trainer|instructor)|who (was|is) the (trainer|instructor)|instructor('s)? name/i],
    ['clientsAffected', /were (any )?clients? affected|did (any )?members? (experience|notice)|client impact/i],
    ['incidentDateTime', /when (did|was|did you notice)|what time|approx(imate)? (date|time)|incident (date|time)/i],
    ['category', /what (type|kind) of (issue|problem)|which category/i],
    ['priority', /how (urgent|critical)|urgency level|what priority/i],
    ['resolutionRequired', /does (this|the) ticket require a resolution|resolution required/i],
  ];
  // Walk pairs: assistant asks → user replies
  for (let i = 0; i < messages.length - 1; i += 1) {
    const assistantMsg = messages[i];
    const userMsg = messages[i + 1];
    if (assistantMsg.role !== 'assistant' || userMsg.role !== 'user') continue;
    const userReply = cleanString(userMsg.content);
    if (!userReply || userReply.length < 2) continue;
    for (const [fieldId, pattern] of CHECKABLE) {
      if (pattern.test(assistantMsg.content) && !cleanString(context[fieldId])) {
        answered.add(fieldId);
      }
    }
  }
  return answered;
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item)).filter(Boolean).slice(0, 8);
}

function recommendedResolutionStepsForDraft(draft: DraftTicket): string[] {
  const combined = [
    draft.title,
    draft.description,
    draft.category,
    draft.subCategory,
    draft.priority,
    draft.sentiment || '',
  ].join(' ').toLowerCase();

  const steps: string[] = [];
  if (/refund|billing|payment|membership|package|freeze|roll\s?over|credit|renewal|pricing/.test(combined)) {
    steps.push(
      'Verify the member, active package, purchase/payment context, and relevant Momence booking before taking action.',
      'Confirm the member requested outcome, amount or credit impact, and preferred follow-up channel.',
      'Document the approved resolution path, owner, and response deadline in the ticket.',
    );
  } else if (/facility|equipment|maintenance|repair|studio|temperature|clean|ac|plumbing|electrical|\bdoor\b|\block\b|tool|bike|machine/.test(combined)) {
    steps.push(
      'Confirm the exact studio space, equipment/tool, fault state, and current operational impact.',
      'Assign the studio operations owner to inspect or coordinate the fix before the next affected session.',
      'Record any temporary workaround and whether members or scheduled sessions were affected.',
    );
  } else if (/class|session|trainer|instructor|booking|waitlist|late|check.?in|schedule/.test(combined)) {
    steps.push(
      'Verify the Momence session, booking status, instructor, class time, and impacted member list.',
      'Confirm what the member reported, what was offered in the moment, and what follow-up they requested.',
      'Route to the class/session owner with the expected member-facing response timeline.',
    );
  } else {
    steps.push(
      'Acknowledge the documented member or staff concern and confirm the expected outcome.',
      'Route the ticket to the assigned owner with the specific next action and due timeline.',
      'Log the internal action taken and member-facing update before resolving the ticket.',
    );
  }

  steps.push(
    draft.memberName || draft.memberContact
      ? 'Confirm the linked Momence member record and contact details before closure.'
      : 'Attach the Momence member record if the resolution depends on a specific community member.',
    draft.classType || draft.classDateTime
      ? 'Confirm the selected Momence session context is accurate before closure.'
      : 'Attach the relevant Momence session if the issue affected a class, booking, or instructor touchpoint.',
  );

  if (draft.priority === 'Critical' || /angry|frustrat|unsafe|injur|breach|legal|escalat/.test(combined)) {
    steps.push('Escalate same day to the escalation manager with the risk, owner, and response timeline.');
  }

  return Array.from(new Set(steps)).slice(0, 6);
}

function withRecommendedResolutionMetadata(draft: DraftTicket): DraftTicket {
  const metadata = draft.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};
  const existingSteps = safeStringList(metadata.recommendedResolutionSteps);
  const recommendedResolutionSteps = existingSteps.length ? existingSteps : recommendedResolutionStepsForDraft(draft);
  return {
    ...draft,
    metadata: {
      ...metadata,
      recommendedResolutionSteps,
    },
  };
}

/**
 * Entity fields that should only appear in a detailForm when the business-logic guard
 * (requiredFieldsForIssue) also says they are needed.
 * This prevents the AI from hallucinating member/class fields for facility issues.
 */
const PROTECTED_ENTITY_FIELD_IDS = new Set([
  'memberName',
  'memberContact',
  'memberId',
  'classType',
  'classDateTime',
  'trainer',
  'sessionId',
  'membership',
]);

/**
 * AI drives, guard is a floor. The AI owns which contextual questions to ask, so its
 * proposed fields are kept — both canonical and invented snake_case fields. The guard
 * only enforces a minimum: it never deletes the AI's questions. Two safety rules remain:
 *   1. reportedBy is always dropped (supplied by the signed-in user).
 *   2. Protected entity fields (member/class Momence pickers) are dropped UNLESS the guard
 *      flagged them — this stops the AI from rendering a member/session search on a pure
 *      facility/ops incident that does not involve a specific person or booking.
 * Guard-required fields the AI included are forced required; guard-required fields the AI
 * omitted are appended by the caller so the hard gates (clientsAffected, resolutionRequired,
 * studio) still hold.
 */
function filterAiDetailFormFields(
  form: AiDetailForm | null | undefined,
  guardedFields: DetailFieldId[],
): AiDetailForm | null {
  if (!form) return null;
  const guardedSet = new Set<string>(guardedFields);
  const filteredFields = form.fields.flatMap((field) => {
    if (field.id === 'reportedBy') return [];
    if (PROTECTED_ENTITY_FIELD_IDS.has(field.id) && !guardedSet.has(field.id)) return [];

    const canonicalType = getGuardFieldType(field.id);
    if (!canonicalType) {
      return [field];
    }

    const normalizedField: AiDetailField = {
      ...field,
      label: '',
      type: canonicalType,
    };
    if (guardedSet.has(field.id)) {
      normalizedField.required = true;
    } else {
      delete normalizedField.required;
    }
    return [normalizedField];
  });
  if (filteredFields.length === 0) return null;
  return { ...form, fields: filteredFields };
}

/**
 * Appends guard-required fields the AI omitted, so the deterministic floor (the hard intake
 * gates) is always satisfied even when the AI's form focused only on contextual questions.
 */
function mergeGuardFloorIntoForm(
  form: AiDetailForm | null,
  guardedFields: DetailFieldId[],
): AiDetailForm | null {
  if (!guardedFields.length) return form;
  const present = new Set((form?.fields || []).map((field) => field.id));
  const missingGuardFields = guardedFields.filter((id) => !present.has(id));
  if (!missingGuardFields.length) return form;
  const guardFieldEntries = missingGuardFields.map((id) => buildGuardFieldDefinition(id));
  if (!form) {
    return {
      title: 'Complete ticket intake details',
      description: 'Athena inferred the classification and needs these details before drafting.',
      fields: guardFieldEntries,
      submitLabel: 'Continue drafting ticket',
    };
  }
  return { ...form, fields: [...form.fields, ...guardFieldEntries] };
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toFixed(8)).join(',')}]`;
}

async function fetchKnowledgeContext(body: RequestBody, context: Record<string, unknown>): Promise<string> {
  const searchText = buildKnowledgeSearchText({
    messages: body.messages || [],
    context,
  });
  if (!searchText.trim()) return '';

  const provider = body.embeddingProvider === 'deepseek' ? 'deepseek' : body.embeddingProvider === 'openai' ? 'openai' : null;
  const embedded = await embedKnowledgeText((name) => Deno.env.get(name) || undefined, fetch, searchText, provider);
  if (!embedded) return '';

  const supabaseUrl = Deno.env.get('TICKETING_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('TICKETING_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return '';

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc('match_knowledge_chunks', {
    query_embedding: vectorLiteral(embedded.embedding),
    match_count: 5,
    similarity_threshold: 0.2,
  });
  if (error) {
    console.warn('Knowledge retrieval failed:', error.message);
    return '';
  }

  return formatKnowledgeContext((data || []) as KnowledgeChunk[]);
}

async function askAiForIntake(body: RequestBody, instructions: string, knowledgeContext = ''): Promise<AiIntakeResponse | null> {
  const result = await callJsonAi((name) => Deno.env.get(name) || undefined, fetch, {
    provider: body.aiProvider,
    temperature: 0.2,
    systemContent: [
      instructions,
      '',
      'Return JSON only using this schema:',
      '{"needsMoreInfo": boolean, "reply": string, "inferredContext": {"intakeRoute": string, "category": string, "subCategory": string, "priority": string, "studio": string, "clientsAffected": string, "classImpactType": string, "memberSentiment": string, "desiredResolution": string, "membership": string}, "urgencyReason": string, "missingFields": string[], "publishable": boolean, "detailForm": {"title": string, "description": string, "fields": [{"id": string, "label": string, "type": "select|text|textarea|date|datetime-local|number", "required": boolean, "options": string[]}], "submitLabel": string}, "ticket": {"title": string, "description": string, "category": string, "subCategory": string, "priority": string, "studio": string, "metadata": {"recommendedResolutionSteps": string[]}}|null, "suggestedChips": []}',
      '',
      'ANTI-LOOP (CRITICAL): Check the last assistant message in the messages array. If it was a plain conversational question and the user replied, that question is ANSWERED — do not re-ask it. Never ask for "member\'s own words", "verbatim report", or any paraphrase — the conversation history already contains this. Accept any user reply (even one word) and move on.',
      'Master-data fields must use these exact IDs when needed: intakeRoute, category, subCategory, clientsAffected, studio, trainer, classType, membership, memberName, memberContact, priority, description, desiredResolution, incidentDateTime, memberSentiment, momencePurchaseContext, classImpactType, classImpactDetails.',
      'Do not ask for reportedBy; the frontend supplies it from the signed-in user.',
      'For issue-specific fields, create clear snake_case IDs prefixed by the category or subcategory. Prefer select fields with options for every bounded answer. Use text/textarea only when the value is genuinely open-ended.',
      'Never ask constants, dates, timestamps, counts, amounts, priority, category, studio, sentiment, class impact, clients affected, status, or resolution yes/no as plain text. Use select/date/datetime-local/number.',
      'When exactly one select field is needed, prefer suggestedChips for that field so the UI renders button options. Keep detailForm null in that case unless a Momence picker is required.',
      'Infer category and subCategory from the report whenever possible. Ask for category or subCategory only when the text is genuinely ambiguous after using the approved master data. ALWAYS pick subCategory from masterData.categorySubcategories[category] — never use "Other" unless it is explicitly listed there for that category.',
      `Use clientsAffected only when member/client impact is relevant; valid values are: ${CLIENTS_AFFECTED_OPTIONS.join(', ')}.`,
      'If clientsAffected starts with "Yes" and specific affected members matter for resolution, use memberName so the frontend renders Momence member search.',
      `If a class/session/schedule was materially affected and the owner needs the session record, use classType, classImpactType, and classImpactDetails. classImpactType options: ${CLASS_IMPACT_TYPE_OPTIONS.join(', ')}.`,
      'If memberName/memberContact is needed, use memberName so the frontend renders Momence member search.',
      'If class/session details are needed, use classType so the frontend renders Momence session search.',
      'Use memberName, memberContact, classType, sessionId, classDateTime, or trainer whenever the conversation context makes those records useful; otherwise ask a natural clarifying question.',
      'If knowledgeContext contains relevant SOP, policy, troubleshooting, or resolution content, use it to answer the staff member and to make recommendedResolutionSteps more specific. Cite the source title when using it. If it is not relevant, ignore it.',
      'When ticket is not null, include ticket.metadata.recommendedResolutionSteps with 4-6 issue-specific steps the owner can follow to resolve the ticket.',
    ].join('\n'),
    userContent: JSON.stringify({
      context: body.context || {},
      masterData: SERVER_MASTER_DATA,
      knowledgeContext,
      messages: body.messages || [],
    }),
  });
  if (!result) {
    console.warn('[athena-intake] AI provider unavailable or request failed — falling back to regex intake. Check AI_PROVIDER + API key/model secrets.');
    return null;
  }
  const parsed = normalizeAiIntakeResponse(parseJsonObject(result.content));
  if (!parsed) {
    console.warn(`[athena-intake] AI provider=${result.provider} model=${result.model} returned unparseable output — falling back to regex intake.`);
    return null;
  }
  console.log(`[athena-intake] AI provider=${result.provider} model=${result.model} drove intake (needsMoreInfo=${parsed.needsMoreInfo}).`);
  return {
    ...parsed,
    provider: result.provider,
    model: result.model,
  };
}

type AiReportNarrative = {
  summary: string;
  findings: string[];
  risks: string[];
  recommendedActions: string[];
  dataQualityNotes: string[];
  generatedByAi: boolean;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item)).filter(Boolean).slice(0, 8);
}

function normalizeRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => (
    Boolean(item) &&
    typeof item === 'object' &&
    !Array.isArray(item)
  ));
}

function cleanReportValue(value: unknown, fallback = '0'): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function fallbackReportNarrative(body: RequestBody): AiReportNarrative {
  const metrics = normalizeRecordArray(body.metrics);
  const dataQualityNotes = normalizeStringArray(body.dataQualityNotes);
  const ticketCount = metrics.find((metric) => metric.id === 'ticket_count')?.value;
  const breached = metrics.find((metric) => metric.id === 'sla_breached')?.value;
  const highPriority = metrics.find((metric) => metric.id === 'high_priority')?.value;
  return {
    summary: `Report ${cleanString(body.reportId, 'selected report')} covers ${cleanReportValue(ticketCount, 'the filtered')} tickets for the requested period.`,
    findings: metrics.slice(0, 5).map((metric) => `${cleanReportValue(metric.label, cleanReportValue(metric.id, 'Metric'))}: ${cleanReportValue(metric.value)}`),
    risks: [
      `SLA breached tickets: ${cleanReportValue(breached)}.`,
      `Critical or High priority tickets: ${cleanReportValue(highPriority)}.`,
    ],
    recommendedActions: [
      'Review the highest-risk source rows before sharing the report.',
      'Use the recurring category and owner workload signals to assign follow-up owners.',
      'Improve intake fields called out in the data-quality notes.',
    ],
    dataQualityNotes,
    generatedByAi: false,
  };
}

function normalizeReportNarrative(value: Record<string, unknown> | null, body: RequestBody): AiReportNarrative {
  const fallback = fallbackReportNarrative(body);
  if (!value) return fallback;
  const dataQualityNotes = normalizeStringArray(value.dataQualityNotes);
  return {
    summary: cleanString(value.summary, fallback.summary),
    findings: normalizeStringArray(value.findings).length ? normalizeStringArray(value.findings) : fallback.findings,
    risks: normalizeStringArray(value.risks).length ? normalizeStringArray(value.risks) : fallback.risks,
    recommendedActions: normalizeStringArray(value.recommendedActions).length
      ? normalizeStringArray(value.recommendedActions)
      : fallback.recommendedActions,
    dataQualityNotes: dataQualityNotes.length ? dataQualityNotes : fallback.dataQualityNotes,
    generatedByAi: typeof value.generatedByAi === 'boolean' ? value.generatedByAi : true,
  };
}

async function askAiForReportNarrative(body: RequestBody): Promise<AiReportNarrative> {
  const result = await callJsonAi((name) => Deno.env.get(name) || undefined, fetch, {
    provider: body.aiProvider,
    temperature: 0.2,
    systemContent: [
      'You are Athena, the Physique 57 India internal operations reporting assistant.',
      'Write concise executive reporting prose from computed metrics only.',
      'Do not invent counts, rates, tickets, members, owners, departments, or financial impact.',
      'Do not expose member contact details. Refer to source rows only by ticket ID/title/category when needed.',
      'Use third-person internal operations language.',
      'Return JSON only with this schema:',
      '{"summary": string, "findings": string[], "risks": string[], "recommendedActions": string[], "dataQualityNotes": string[]}',
    ].join('\n'),
    userContent: JSON.stringify({
      reportId: body.reportId,
      period: body.period,
      filters: body.filters,
      metrics: body.metrics,
      sections: body.sections,
      topRows: body.topRows,
      dataQualityNotes: body.dataQualityNotes,
      assumptions: body.assumptions,
    }),
  });
  if (!result) return fallbackReportNarrative(body);
  return normalizeReportNarrative(parseJsonObject(result.content), body);
}

function inferContextFromText(text: string, context: Record<string, unknown> = {}): Record<string, string> {
  const lower = [
    text,
    cleanString(context.initialReport),
    cleanString(context.requestType),
    cleanString(context.category),
    cleanString(context.subCategory),
    cleanString(context.description),
  ].filter(Boolean).join(' ').toLowerCase();
  const inferred: Record<string, string> = {};

  if (!cleanString(context.intakeRoute)) {
    if (/hosted class|host class|post-class feedback|attendees|lead tracking|lead feedback/.test(lower)) inferred.intakeRoute = 'Feedback';
    else if (/refund|freeze|roll\s?over|extension|reschedule|request|need|asked|wants|would like|approval|waiver|upgrade|remove her name|share details/.test(lower)) inferred.intakeRoute = 'Request';
    else if (/complain|angry|frustrated|unhappy|not resolved|delay|issue|problem|concern|denied|walked out|missing|stolen|harass|poach/.test(lower)) inferred.intakeRoute = 'Complaint';
    else if (/reported|feedback|suggested|said|shared|mentioned|compliment|liked|loved|lead|hosted class|post-class/.test(lower)) inferred.intakeRoute = 'Feedback';
    else inferred.intakeRoute = 'Internal Reporting';
  }

  if (!cleanString(context.category)) {
    if (/momence|crm|zoho|data accuracy|handover|sop|standard operating|process|workflow|payroll|performance review|finance|reconciliation|upi|marketing|campaign|collateral|partnership approval|internal operations|internal memo/.test(lower)) {
      inferred.category = 'Operating Systems';
      inferred.subCategory = /momence|crm|data/.test(lower) ? 'Momence Issues' : /payment|upi|reconciliation|finance/.test(lower) ? 'Payment Gateway Issue' : 'Technical Assistance';
    } else if (/hosted|host class|influencer|partner|lead tracking|lead feedback|guestlist|collaboration/.test(lower)) {
      inferred.category = 'Hosted Class & Partnerships';
      inferred.subCategory = /lead|sales|conversion|prospect|drop-in|share details|requested/.test(lower) ? 'Prospect Conversion Opportunity' : /swap|instructor/.test(lower) ? 'Partner Instructor Feedback' : 'Hosted Class Feedback';
    } else if (/billing|refund|payment|freeze|roll over|rollover|extension|membership|package|renewal|expiry|credit|late cancellation|waiver|upgrade/.test(lower)) {
      inferred.category = 'Pricing and Memberships';
      inferred.subCategory = /freeze|pause/.test(lower) ? 'Membership Pause and Freeze Policy' : /refund|waiver/.test(lower) ? 'Refund and Cancellation Policy Issue' : /upgrade|downgrade/.test(lower) ? 'Membership Upgrade/Downgrade' : 'Class Pack Expiry Confusion';
    } else if (/injury|safety|medical|harassment|security|theft|stolen|missing cash|cash envelope|unsafe|faint|cramp|conflict/.test(lower)) {
      inferred.category = 'Safety and Security';
      inferred.subCategory = /theft|stolen|missing cash|cash envelope/.test(lower) ? 'Theft Prevention Measures' : /harass|conflict/.test(lower) ? 'Harassment Reports' : 'Personal Safety Concerns';
    } else if (
      /repair|maintenance|broken|not working|not closing|not opening|stopped working|isn't working|isnt working|won't close|won't open|malfunction|faulty|damaged|damage|crack|cracked|leak|leaking|overflow|plumbing|drain|clog|clogged|flush|sewage|socket|electrical|wiring|bulb|fused|flickering|lights not|light not|machine|washing machine|dryer|washing|pump|generator|pest|pest control|mold|mould|damp|seepage|\bdoor\b|\block\b|latch|handle|hinge/.test(lower) ||
      HVAC_TEXT_PATTERN.test(lower)
    ) {
      inferred.category = 'Repair and Maintenance';
      inferred.subCategory = HVAC_TEXT_PATTERN.test(lower) ? 'AC and HVAC Issues'
        : /light|bulb|fused|flickering/.test(lower) ? 'Lighting Issues'
        : /audio|speaker|mic|sound/.test(lower) ? 'Audio System Malfunction'
        : /leak|plumbing|drain|flush|sewage|overflow|clog|pipe/.test(lower) ? 'Plumbing Leaks'
        : /pest|cockroach|rat|rodent|insect|ant/.test(lower) ? 'Pest Control Needed'
        : /\bdoor\b|\block\b|latch|hinge/.test(lower) ? 'Door Lock Issues'
        : /machine|washing|dryer|equipment|broken|not working|malfunction|faulty/.test(lower) ? 'Broken Equipment'
        : 'General Maintenance Delays';
    } else if (/odour|odor|smell|stench|ventilation|air quality|locker|shower|washroom|toilet|steam room|valet|parking|wi-fi|wifi|boutique|retail|amenity|amenities|cleanliness|hygiene|clean|dirty/.test(lower)) {
      inferred.category = 'Studio Amenities and Facilities';
      inferred.subCategory = /temperature|too hot|too cold|cold|hot/.test(lower) ? 'Air Quality Poor'
        : /ventilation|air quality/.test(lower) ? 'Ventilation Poor'
        : /clean|hygiene|dirty/.test(lower) ? 'Cleanliness and Hygiene'
        : /locker/.test(lower) ? 'Locker Availability'
        : /boutique|retail/.test(lower) ? 'Boutique Availability Issues'
        : /steam/.test(lower) ? 'Steam Room Not Working'
        : 'Studio Odour and Aroma';
    } else if (/temperature|too hot|too cold|air\s?con|air quality/.test(lower)) {
      // Temperature/AC complaints that didn't match maintenance (i.e. comfort complaints, not breakdowns)
      inferred.category = 'Studio Amenities and Facilities';
      inferred.subCategory = 'Air Quality Poor';
    } else if (/trainer|instructor|class|music|cue|correction|adjustment|overcrowded/.test(lower)) {
      inferred.category = /trainer|instructor|correction|adjustment|punctual|engagement|no-show/.test(lower) ? 'Trainer Feedback' : 'Class Experience';
      inferred.subCategory = /overcrowd|capacity/.test(lower) ? 'Overcrowding in Class' : /audio|music|loud/.test(lower) ? 'Audio Issues' : /punctual|late|no-show/.test(lower) ? 'Trainer Punctuality Issues' : /intensity/.test(lower) ? 'Class Intensity Too High/Low' : 'Class Flow and Pacing';
    } else if (/app crash|app not|app freezing|login issue|login error|password reset|push notification|booking confirmation missing|payment gateway|momence account|sync issue|profile issue|website glitch|website not|website down|qr code|ipad not|ipad issue/.test(lower)) {
      inferred.category = 'App & Digital';
      inferred.subCategory = /crash|freeze|not responding/.test(lower) ? 'App Crash'
        : /login|password/.test(lower) ? 'Login Issue'
        : /notification/.test(lower) ? 'Push Notifications'
        : /payment|gateway/.test(lower) ? 'Payment Gateway Issue'
        : /momence|sync/.test(lower) ? 'Momence Account Sync'
        : /booking confirm/.test(lower) ? 'Booking Confirmation Missing'
        : /website/.test(lower) ? 'Website Chat / Lead Form Issue'
        : 'App Crash';
    } else if (/booking|schedule|class availability|late entry|waitlist|cancelled|reschedule|timing|variety/.test(lower)) {
      inferred.category = 'Scheduling';
      inferred.subCategory = /late entry/.test(lower) ? 'Late Arrival Policy' : /availability|variety/.test(lower) ? 'Additional Classes' : /cancel/.test(lower) ? 'Last-minute Cancellations' : 'Class Capacity Issues';
    } else if (/whatsapp|call|email|response|follow-up|front desk|communication/.test(lower)) {
      inferred.category = 'Customer Service and Communication';
      inferred.subCategory = 'Delay in Response';
    } else if (/sales|lead|trial|conversion|competitor|price|drop-in|location too far|prospect/.test(lower)) {
      inferred.category = 'Sales & Consultation';
      inferred.subCategory = /competitor/.test(lower) ? 'Competitor Mentioned' : /price|drop-in/.test(lower) ? 'Prospect Price Concern' : 'Lead Quality Note';
    } else {
      inferred.category = 'General Feedback';
      inferred.subCategory = 'Other';
    }
  }

  if (!cleanString(context.priority)) {
    if (/injury|medical|harassment|security|theft|stolen|unsafe|emergency|missing cash|40,000/.test(lower)) inferred.priority = 'Critical';
    else if (/angry|frustrated|urgent|refund|not resolved|escalat|renewal|cancel|walked out|denied|poach|high-value/.test(lower)) inferred.priority = 'High';
    else if (/complain|issue|concern|delay|request|follow-up|hosted|lead/.test(lower)) inferred.priority = 'Medium';
    else inferred.priority = 'Low';
  }

  if (!cleanString(context.studio)) {
    if (/bandra|supreme hq/.test(lower)) inferred.studio = 'Supreme HQ, Bandra';
    else if (/kemps|kwality/.test(lower)) inferred.studio = 'Kwality House, Kemps Corner';
    else if (/kenkere/.test(lower)) inferred.studio = 'Kenkere House, Bengaluru';
    else if (/copper|cloves/.test(lower)) inferred.studio = 'the Studio by Copper & Cloves, Bengaluru';
    else if (/courtside/.test(lower)) inferred.studio = 'Courtside, Mumbai';
  }

  return inferred;
}

function requiredFieldsForIssue(
  _text: string,
  context: Record<string, unknown>,
  _options: { includeClientImpact?: boolean } = {},
): DetailFieldId[] {
  const intakeRoute = cleanString(context.intakeRoute);
  const category = cleanString(context.category);
  const subCategory = cleanString(context.subCategory);
  const fields: DetailFieldId[] = [];
  const add = (field: DetailFieldId, value?: unknown) => {
    const cleaned = cleanString(value);
    if (!cleaned || PLACEHOLDER_VALUE_PATTERN.test(cleaned)) fields.push(field);
  };

  // Hard minimums only — the AI handles all issue-specific field collection.
  add('intakeRoute', context.intakeRoute);
  if (!intakeRoute) return Array.from(new Set(fields));

  add('category', context.category);
  add('subCategory', context.subCategory);
  if (!category || !subCategory) return Array.from(new Set(fields));

  const studioCategories = new Set([
    'Scheduling', 'Class Experience', 'Trainer Feedback', 'Repair and Maintenance',
    'Studio Amenities and Facilities', 'Safety and Security', 'Theft and Lost Items',
    'Miscellaneous', 'Instructor & Class Quality', 'Booking & Schedule',
    'Facility & Equipment', 'Front Desk & Service', 'Safety & Medical',
  ]);
  if (studioCategories.has(category)) add('studio', context.studio);

  add('priority', context.priority);
  add('resolutionRequired', context.resolutionRequired);

  return Array.from(new Set(fields));
}

function buildSourceRef(draft: DraftTicket, context: Record<string, unknown> = {}, conversationId?: string | null): string {
  const explicitConversationId =
    conversationId ||
    (typeof context.conversationId === 'string' ? context.conversationId : null);
  if (explicitConversationId) return `approved-draft:${explicitConversationId}`;

  const seed = [
    draft.title,
    draft.category,
    draft.subCategory,
    draft.memberName || '',
    draft.memberContact || '',
    draft.studio || '',
    draft.description.slice(0, 180),
  ].join('|');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return `approved-draft:${Math.abs(hash).toString(36)}`;
}

function toTicketRow(
  draft: DraftTicket,
  context: Record<string, unknown> = {},
  conversationId?: string | null,
  createdBy?: string | null,
) {
  const draftMetadata = draft.metadata && typeof draft.metadata === 'object' ? draft.metadata : {};
  const recommendedResolutionSteps = safeStringList(draftMetadata.recommendedResolutionSteps).length
    ? safeStringList(draftMetadata.recommendedResolutionSteps)
    : recommendedResolutionStepsForDraft(draft);
  const profileOnly = draft.metadata?.profileOnly === true || draft.tags?.includes('profile-only');
  const recordOnly = !profileOnly && !ticketRequiresResolution(context);
  const priority = normalizePriority(draft.priority);
  const fallbackAssignment = resolveAssignment(draft.category, draft.studio, draft.subCategory);
  const assignedTo = profileOnly ? 'Trainer Profile' : recordOnly ? RECORD_ONLY_ASSIGNEE : cleanString(draft.assignedTo)
    || cleanString(context.assignedTo)
    || cleanString(context.owner)
    || fallbackAssignment.assignedTo;
  const team = profileOnly ? 'Training & Client Experience' : normalizeDepartmentName(cleanString(draft.department)
    || cleanString(context.department)
    || cleanString(context.team)
    || fallbackAssignment.team);
  const effectivePriority = profileOnly ? 'Low' : priority;
  const sourceRef = buildSourceRef(draft, context, conversationId);
  const status = profileOnly || recordOnly ? 'Closed' : 'New';
  const slaDueAt = profileOnly
    ? cleanString(draft.classDateTime, new Date().toISOString())
    : recordOnly
      ? new Date().toISOString()
      : computeSlaDueAt(effectivePriority);

  return {
    source_ref: sourceRef,
    title: cleanString(draft.title, 'Member support ticket'),
    description: cleanString(draft.description, 'No description provided.'),
    category: cleanString(draft.category, 'General Feedback'),
    sub_category: cleanString(draft.subCategory, 'Other'),
    priority: effectivePriority,
    status,
    studio: cleanString(draft.studio, 'Unspecified Studio'),
    trainer: draft.trainer || null,
    class_type: draft.classType || null,
    class_date_time: draft.classDateTime || null,
    member_name: draft.memberName || null,
    member_contact: draft.memberContact || null,
    reported_by: draft.reportedBy || 'AI Intake',
    assigned_to: assignedTo,
    team,
    tags: Array.from(new Set([
      ...(draft.tags || []),
      'ai-approved',
      profileOnly ? 'profile-only' : recordOnly ? 'record-only' : '',
      recordOnly ? 'no-resolution-required' : '',
    ])).filter(Boolean),
    sentiment: draft.sentiment || null,
    conversation_summary: draft.conversationSummary || draft.description,
    metadata: {
      ...draftMetadata,
      recommendedResolutionSteps,
      source_ref: sourceRef,
      profileOnly,
      resolution_required: !recordOnly,
      no_sla: recordOnly,
      intake_context: context,
      routing: {
        department: team,
        assigned_to: assignedTo,
        owner_pool: recordOnly ? [] : [assignedTo],
        next_escalation: recordOnly ? null : undefined,
        status,
        priority: effectivePriority,
        profile_only: profileOnly,
        resolution_required: !recordOnly,
        sla_due_at: recordOnly ? null : slaDueAt,
        routing_source: profileOnly ? 'trainer_profile_record' : recordOnly ? 'record_only' : assignedTo === fallbackAssignment.assignedTo ? 'athena_employee_directory' : 'approved_context',
      },
    },
    created_by: createdBy || null,
    sla_due_at: slaDueAt,
  };
}

function getMissingColumnName(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as Record<string, unknown>;
  if (value.code !== '42703') return null;
  const message = typeof value.message === 'string' ? value.message : '';
  const details = typeof value.details === 'string' ? value.details : '';
  const match = `${message} ${details}`.match(/column "([^"]+)"/i);
  return match?.[1] || null;
}

function removeUnsupportedTicketColumn<T extends Record<string, unknown>>(row: T, column: string): T {
  if (!(column in row)) return row;
  const next = { ...row };
  delete next[column];
  return next as T;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await request.json() as RequestBody;
    const authResult = await authenticateRequest(request);
    if (authResult instanceof Response) return authResult;
    const authUser = authResult.user;

    if (body.action === 'generateReportNarrative') {
      const narrative = await askAiForReportNarrative(body);
      return json({
        narrative,
        summary: narrative.summary,
        findings: narrative.findings,
        risks: narrative.risks,
        recommendedActions: narrative.recommendedActions,
        dataQualityNotes: narrative.dataQualityNotes,
      });
    }

    if (body.action === 'createTicket' || body.approved === true) {
      const draft = body.draft || body.ticket;
      if (!draft) return json({ error: 'Approved ticket creation requires a draft' }, 400);

      const supabaseUrl = Deno.env.get('TICKETING_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('TICKETING_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!supabaseUrl || !serviceRoleKey) {
        return json({ error: 'Missing Supabase service role configuration' }, 500);
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const sourceRef = buildSourceRef(draft, body.context || {}, body.conversationId);
      const findExistingTicket = async () => {
        const byMetadata = await supabase
          .from('tickets')
          .select('*')
          .contains('metadata', { source_ref: sourceRef })
          .maybeSingle();
        if (!byMetadata.error || byMetadata.data) return byMetadata;

        const bySourceRef = await supabase
          .from('tickets')
          .select('*')
          .eq('source_ref', sourceRef)
          .maybeSingle();
        if (bySourceRef.error?.code === '42703') return byMetadata;
        return bySourceRef;
      };

      const { data: existing } = await findExistingTicket();

      if (existing) {
        return json({
          reply: `Ticket ${existing.id} was already created from this approved draft.`,
          createdTicket: existing,
        });
      }

      let rowForInsert = toTicketRow(draft, body.context || {}, body.conversationId, authUser.id);
      let data: Record<string, unknown> | null = null;
      let createError: { code?: string; message?: string } | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await supabase
          .from('tickets')
          .insert(rowForInsert)
          .select('*')
          .single();

        if (!result.error) {
          data = result.data;
          createError = null;
          break;
        }

        createError = result.error;
        const missingColumn = getMissingColumnName(result.error);
        if (!missingColumn || !(missingColumn in rowForInsert)) break;
        rowForInsert = removeUnsupportedTicketColumn(rowForInsert, missingColumn);
      }

      if (createError || !data) {
        if (createError?.code === '23505') {
          const { data: duplicated } = await findExistingTicket();
          if (duplicated) {
            return json({
              reply: `Ticket ${duplicated.id} was already created from this approved draft.`,
              createdTicket: duplicated,
            });
          }
        }
        return json({ error: createError?.message || 'Ticket creation failed' }, 500);
      }

      const ticketId = cleanString(data.id);
      const { error: eventError } = await supabase.from('ticket_events').insert({
        ticket_id: ticketId,
        event_type: 'ticket_created',
        actor: draft.reportedBy || authUser.email || 'Authenticated user',
        to_value: 'New',
        metadata: {
          conversationId: body.conversationId,
          source: 'approved_draft',
        },
        created_by: authUser.id,
      });
      if (eventError) {
        console.warn('Ticket event logging failed:', eventError.message);
      }

      return json({
        reply: `Ticket ${ticketId} has been created from the approved draft.`,
        createdTicket: data,
      });
    }

    const messages = body.messages || [];
    const promptProfile = cleanString(body.promptProfile, 'athena-intake-v1');
    const instructions = ATHENA_SYSTEM_PROMPT;
    const debugTraceRequested = body.debugTrace === true;
    const traceId = crypto.randomUUID();
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content || '';

    // Strip context preamble the frontend prepends to get the raw issue text
    const rawIssueText = latestUserMessage.replace(/^\[Context[^\]]*\]\s*/i, '').trim();

    if (isCasualGreeting(rawIssueText)) {
      const trace = debugTraceRequested
        ? buildDecisionTrace({
            traceId,
            conversationId: body.conversationId || traceId,
            promptProfile: `${promptProfile}:greeting`,
            requestedDebug: debugTraceRequested,
            path: 'greeting',
            rawIssueText,
            effectiveContext: body.context || {},
            aiResponse: null,
            guardedMissingFields: [],
            finalForm: null,
            remainingMissingFields: [],
            finalNeedsMoreInfo: false,
            finalPublishable: false,
            finalTicketPresent: false,
          })
        : null;
      if (trace) logDecisionTrace(trace);
      return json({
        conversationId: body.conversationId || crypto.randomUUID(),
        promptProfile: `${promptProfile}:greeting`,
        needsMoreInfo: false,
        reply: "Hi, I'm Athena. What are we logging?",
        detailForm: null,
        ticket: null,
        suggestedChips: [
          { label: 'Complaint', value: 'Complaint', field: 'intakeRoute' },
          { label: 'Request', value: 'Request', field: 'intakeRoute' },
          { label: 'Feedback', value: 'Feedback', field: 'intakeRoute' },
        ],
        inferredContext: {},
        missingFields: [],
        publishable: false,
        urgencyReason: '',
        debugTrace: trace,
      });
    }

    const isFormSubmission = /^here are the missing details/i.test(rawIssueText);
    const bodyContext = body.context || {};
    const effectiveBodyContext: Record<string, unknown> = { ...bodyContext };
    if (!isFormSubmission && !cleanString(effectiveBodyContext.initialReport) && rawIssueText) {
      effectiveBodyContext.initialReport = rawIssueText;
    }

    const bodyWithEffectiveContext = { ...body, context: effectiveBodyContext };
    const knowledgeContext = await fetchKnowledgeContext(bodyWithEffectiveContext, effectiveBodyContext);
    const aiResponse = await askAiForIntake(bodyWithEffectiveContext, instructions, knowledgeContext);

    if (aiResponse) {
      const aiContext = { ...effectiveBodyContext, ...(aiResponse.inferredContext || {}) };

      // Run deterministic guard against the merged context so the AI cannot skip
      // required fields (e.g. category, studio, clientsAffected) by claiming needsMoreInfo=false
      // before those gates are satisfied. The guard is a floor — it never removes AI questions.
      const conversationallyAnswered = extractConversationallyAnsweredFields(messages, aiContext);
      const rawGuardedFields = requiredFieldsForIssue(rawIssueText, aiContext);
      const guardedMissingFields: DetailFieldId[] = rawGuardedFields.filter(
        (field) => !conversationallyAnswered.has(field),
      );

      // Filter + merge: keep all AI form fields, strip protected entity fields the guard
      // didn't require, force-required guard fields, append any guard fields AI omitted.
      const filteredAiForm = filterAiDetailFormFields(aiResponse.detailForm, guardedMissingFields);
      const finalForm = mergeGuardFloorIntoForm(filteredAiForm, guardedMissingFields);

      const needsMoreInfo = aiResponse.needsMoreInfo || finalForm !== null || guardedMissingFields.length > 0;
      const aiTicket = needsMoreInfo ? null : withRecommendedResolutionMetadata(aiResponse.ticket || fallbackDraft(messages, aiContext));
      const remainingMissingFields = guardedMissingFields.filter(
        (field) => !(finalForm?.fields || []).some((f) => f.id === field),
      );
      const trace = debugTraceRequested
        ? buildDecisionTrace({
            traceId,
            conversationId: body.conversationId || traceId,
            promptProfile: `${promptProfile}:ai-dynamic`,
            requestedDebug: debugTraceRequested,
            path: 'ai-dynamic',
            provider: aiResponse.provider,
            model: aiResponse.model,
            rawIssueText,
            effectiveContext: aiContext,
            aiResponse,
            guardedMissingFields,
            finalForm,
            remainingMissingFields,
            finalNeedsMoreInfo: needsMoreInfo,
            finalPublishable: !needsMoreInfo && aiResponse.publishable === true,
            finalTicketPresent: Boolean(aiTicket),
          })
        : null;
      if (trace) logDecisionTrace(trace);
      console.log(`[athena-intake] path=ai-dynamic needsMoreInfo=${needsMoreInfo} guardedFields=${guardedMissingFields.length} formFields=${finalForm?.fields?.length ?? 0}`);
      return json({
        conversationId: body.conversationId || crypto.randomUUID(),
        promptProfile: `${promptProfile}:ai-dynamic`,
        needsMoreInfo,
        reply: needsMoreInfo && !finalForm
          ? 'I need a few details before drafting this ticket. Please complete the form below.'
          : aiResponse.reply,
        detailForm: finalForm,
        ticket: aiTicket,
        suggestedChips: aiResponse.suggestedChips || [],
        inferredContext: aiResponse.inferredContext || {},
        missingFields: aiResponse.missingFields || [],
        publishable: !needsMoreInfo && aiResponse.publishable === true,
        urgencyReason: aiResponse.urgencyReason || '',
        debugTrace: trace,
      });
    }

    const inferredContext = inferContextFromText(latestUserMessage, effectiveBodyContext);
    const effectiveContext = { ...effectiveBodyContext, ...inferredContext };

    const draft = withRecommendedResolutionMetadata(fallbackDraft(messages, effectiveContext));
    const trace = debugTraceRequested
      ? buildDecisionTrace({
          traceId,
          conversationId: body.conversationId || traceId,
          promptProfile: `${promptProfile}:drafted`,
          requestedDebug: debugTraceRequested,
          path: 'drafted-regex',
          rawIssueText,
          effectiveContext: { ...effectiveContext, ...draft },
          aiResponse: null,
          guardedMissingFields: [],
          finalForm: null,
          remainingMissingFields: [],
          finalNeedsMoreInfo: false,
          finalPublishable: true,
          finalTicketPresent: true,
        })
      : null;
    if (trace) logDecisionTrace(trace);
    console.warn(`[athena-intake] path=drafted (regex fallback draft) — AI did not run`);
    return json({
      conversationId: body.conversationId || crypto.randomUUID(),
      promptProfile: `${promptProfile}:drafted`,
      needsMoreInfo: false,
      reply: 'I drafted the ticket below. Please review it before publishing.',
      ticket: draft,
      suggestedChips: [],
      inferredContext,
      missingFields: [],
      publishable: true,
      urgencyReason: inferredContext.priority
        ? `Fallback priority inferred as ${inferredContext.priority} from the report.`
        : '',
      debugTrace: trace,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Ticket AI chat failed' }, 500);
  }
});
