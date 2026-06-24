import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getDocumentProxy, extractText } from 'npm:unpdf@0.12.0';
import { chunkKnowledgeText, embedKnowledgeText } from '../_shared/knowledge-base.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type KnowledgeAction = 'list' | 'upload' | 'update' | 'delete' | 'seedDefaults';

type KnowledgeBody = {
  action?: KnowledgeAction;
  documentId?: string;
  title?: string;
  text?: string;
  sourceUri?: string;
  sectionHeading?: string;
  mimeType?: string;
  embeddingProvider?: 'openai' | 'deepseek' | 'auto';
};

type AdminClient = ReturnType<typeof createClient>;

const DEFAULT_KNOWLEDGE_DOCUMENTS = [
  {
    title: 'Athena Chat Flow Rules',
    sourceUri: 'athena-default://chat-flow-rules',
    sectionHeading: 'Chat flow',
    text: `Athena must analyze the user's message before asking any question. The assistant should first identify the likely issue type, operational owner, business impact, and what information is already present.

Athena must not start with a fixed generic intake checklist. The next question must be based on the specific user message and current conversation context.

Ask only the next one or two highest-value questions. A question is high-value when the assigned owner cannot act without the answer. Avoid asking for information already present in the user message, prior turns, selected context, Momence context, or current draft.

If the previous assistant message asked a question and the user responded, treat that question as answered. Never ask for member's own words, verbatim report, or a rephrased version of the same complaint when the complaint already exists in conversation.

Draft immediately when the report includes enough context to route and act. Ask follow-up questions only when the ticket would otherwise be vague, unroutable, or unactionable.`,
  },
  {
    title: 'Structured Control Priority',
    sourceUri: 'athena-default://structured-control-priority',
    sectionHeading: 'Controls and field types',
    text: `Athena must prioritize buttons, dropdowns, pickers, dates, and numeric inputs over plain text whenever the answer has a known shape.

Use select options for constants such as intake route, category, sub-category, priority, studio, instructor, class impact type, member sentiment, client impact, resolution required, resolution status, communication preference, follow-up preference, feedback type, membership decision type, and operational status.

Use date for freeze start date, freeze end date, package expiry date, requested rollover date, follow-up date, and target resolution date.

Use datetime-local for incident date and time, class/session date and time, first noticed time, scheduled class start time, and actual trainer arrival time.

Use number for minutes late, number of affected members, classes remaining, refund amount, credit amount, repeated incident count, duration in minutes, and quantity of affected tools.

Use Momence member search for memberName, memberContact, or memberId when member lookup is relevant. Use Momence session search for classType, sessionId, classDateTime, or trainer when a specific class/session is involved.`,
  },
  {
    title: 'Athena Master Constants',
    sourceUri: 'athena-default://master-constants',
    sectionHeading: 'Constants',
    text: `Intake routes: Request, Complaint, Feedback, Internal Reporting.

Priority values: Critical, High, Medium, Low.

clientsAffected values: Yes - directly affected; Yes - indirectly affected; Yes - directly and indirectly affected; No clients affected; Not confirmed yet.

classImpactType values: Class delayed; Class paused; Class cancelled; Class moved; Class shortened; Class overcrowded; Member left class; Member service recovery needed; No class impact; Not confirmed yet.

memberSentiment values: Member Expressed Delight / Enthusiasm; Member Expressed Satisfaction; Member Expressed Neutral / Mixed Feelings; Member Expressed Dissatisfaction; Member Expressed Frustration / Anger; Unable to Determine.

resolutionRequired values: Yes, No. If resolutionRequired is No, the ticket may be record-only and should not create unnecessary owner follow-up or SLA pressure.

Canonical field ids include intakeRoute, category, subCategory, priority, studio, clientsAffected, memberName, memberContact, memberId, classType, sessionId, classDateTime, trainer, membership, incidentDateTime, desiredResolution, memberSentiment, classImpactType, classImpactDetails, momencePurchaseContext. Do not ask for reportedBy.`,
  },
  {
    title: 'Routing and SLA Rules',
    sourceUri: 'athena-default://routing-and-sla-rules',
    sectionHeading: 'Routing and SLA',
    text: `Critical priority has a 2 hour SLA and is used for safety, access risk, harassment, theft, injury, medical issue, live operational shutdown, or high-risk escalation.

High priority has an 8 hour SLA and is used for service failures, member retention risk, urgent refunds, live class impact, unresolved complaints, trainer no-show, or visible business disruption.

Medium priority has a 24 hour SLA and is used for normal operational issues, requests, follow-ups, and non-critical member experience issues.

Low priority has a 72 hour SLA and is used for cosmetic issues, informational notes, record-only documentation, compliments, and low-risk improvements.

Pricing, membership, scheduling, booking, sales, and consultation issues usually route to Sales and Client Servicing. Repair, maintenance, studio amenities, facility, equipment, safety, app, digital, operating systems, and tech issues route to Operations, Maintenance, or Technical Support. Trainer feedback and class quality route to Training and Client Experience.`,
  },
  {
    title: 'Member Billing and Membership Intake Rules',
    sourceUri: 'athena-default://member-billing-membership-rules',
    sectionHeading: 'Billing and memberships',
    text: `Use for refunds, freezes, rollovers, extensions, renewals, payment disputes, credits, package expiry, membership upgrades, membership downgrades, and cancellation policy issues.

First determine the decision needed: refund approval, freeze approval, rollover or extension approval, credit adjustment, package correction, payment investigation, policy explanation, or member follow-up.

Use memberName if the member is named or identifiable. Use membership if the decision depends on an active package or membership record. Use momencePurchaseContext when payment, purchase, package, or credit evidence is central to the decision.

Use desiredResolution when the requested outcome is unclear. Use date fields for freeze dates, expiry dates, rollover dates, or follow-up dates. Use number fields for refund amounts, credit amounts, classes remaining, and extension length.

Do not automatically ask for every billing field. Ask only the fields needed for the specific decision. Do not draft a named refund, freeze, or rollover ticket without linking the member or identifying package context when needed for resolution.`,
  },
  {
    title: 'Facilities and Maintenance Intake Rules',
    sourceUri: 'athena-default://facilities-maintenance-intake-rules',
    sectionHeading: 'Facilities and maintenance',
    text: `Use for AC, HVAC, door, lock, plumbing, leaks, lighting, electrical, equipment, washing machine, dryer, pest, odor, cleanliness, locker, washroom, steam room, and studio space issues.

Never use a generic description field for physical or maintenance issues. Ask targeted operational questions that let the owner act.

Identify the exact item or area affected, fault symptom, when it was noticed, whether access, safety, hygiene, or class operations are affected, current workaround, and expected resolution or vendor action.

Use datetime-local for incidentDateTime or first noticed time. Use select for issue state, access/security, and operational impact. Use textarea only for specific fault details that cannot be captured by options.

Broken door questions should capture which door or area is affected, fault type such as lock, latch, handle, hinge, alignment, access card, or unknown, security or access risk, and temporary workaround.`,
  },
  {
    title: 'Class Trainer and Session Intake Rules',
    sourceUri: 'athena-default://class-trainer-session-rules',
    sectionHeading: 'Classes and trainers',
    text: `Use for trainer lateness, no-show, class quality, music volume, cueing, corrections, overcrowding, class delay, cancellation, late entry, waitlist, schedule confusion, or class experience feedback.

Use classType or sessionId so the frontend renders the Momence session picker when a specific class or session is involved. Do not ask staff to type a class name if the session should be selected from Momence.

For trainer lateness or no-show capture session and scheduled start time, actual arrival time or minutes late, whether advance notice was given, reason if known, member impact, whether class was delayed, shortened, cancelled, or covered by another instructor, and whether service recovery is needed.

Use number for minutes late. Use datetime-local for scheduled and actual times. Use select for classImpactType.

Do not ask for member context unless a named member must be followed up with or compensation/service recovery is needed.`,
  },
  {
    title: 'Hosted Class and Partnership Intake Rules',
    sourceUri: 'athena-default://hosted-class-partnership-rules',
    sectionHeading: 'Hosted classes',
    text: `Hosted classes and partnership experiences are specialized sessions curated with influencers, wellness partners, community builders, brands, or partner instructors who bring audiences into the Physique 57 Method.

Capture intelligence for prospect quality, partner audience alignment, conversion potential, guest follow-up, brand visibility, content/social amplification, partnership quality, and revenue pipeline impact.

Use select for hostedFeedbackArea with options such as Guest experience, Partner quality, Prospect quality, Conversion opportunity, Event operations, Instructor feedback, Social/content opportunity, Follow-up needed.

Use select for prospectQuality: High Fit, Moderate Fit, Low Fit, Existing Members Mostly, Unable to Determine.

Use select for followUpPreference: Phone Call, Email, WhatsApp, Instagram DM, In-Person Next Visit, No Follow-up Needed, Member Will Reach Out.

Use number for guest count, new prospect count, existing member count, and follow-up lead count.`,
  },
  {
    title: 'Ticket Draft Quality and Resolution Steps',
    sourceUri: 'athena-default://ticket-draft-quality-resolution-steps',
    sectionHeading: 'Draft quality',
    text: `A good ticket title is specific and operational, such as Bandra front door latch not closing after evening shift, Member Smita Patil requested refund review for unused membership, or Instructor arrived 12 minutes late for 7 AM Barre session.

Bad titles are generic: Maintenance issue, Member complaint, Refund request, Trainer feedback.

Use factual third-person internal language in descriptions: Team member reported, Member requested, Client expressed, Studio associate observed, Instructor shared.

Remove greetings, sign-offs, and filler. Do not paste the user's raw message unchanged.

Every draft should include four to six specific recommended resolution steps referencing actual issue details. Avoid generic steps like confirm the issue, route to owner, follow up with member, or close the loop.

Ticket creation should happen only after explicit user approval of the displayed draft.`,
  },
  {
    title: 'Record-Only and Escalation Rules',
    sourceUri: 'athena-default://record-only-escalation-rules',
    sectionHeading: 'Record-only and escalation',
    text: `Use record-only when staff are documenting information that does not require resolution, owner action, or SLA follow-up. Examples include compliments with no follow-up needed, internal notes for trend tracking, trainer profile-only feedback, already-handled event observations, and member voice logged only for reporting.

If resolutionRequired is No, mark as record-only when creating the ticket, avoid unnecessary owner assignment, avoid SLA pressure, and keep the description factual.

Use actionable routing when a member expects follow-up, refund/freeze/rollover/service recovery is needed, facility repair is needed, class/session issue needs owner review, safety/security/hygiene/access risk exists, or staff ask for resolution.

Escalate as Critical or High for injury, medical risk, harassment, safety concern, theft, missing money, security/access risk, live class disruption, angry member or retention risk, legal threat, or repeated unresolved issue.

If unsure whether a ticket is record-only or actionable, ask: Does this ticket require a resolution? Options: Yes, No. Do not ask this for every ticket automatically.`,
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bearerToken(authorization: string): string {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toFixed(8)).join(',')}]`;
}

async function authenticateRequest(request: Request) {
  const supabaseUrl = Deno.env.get('TICKETING_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('TICKETING_SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('TICKETING_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return { response: json({ error: 'Missing Supabase configuration' }, 500) };

  const token = bearerToken(request.headers.get('authorization') || '');
  if (!token) return { response: json({ error: 'Unauthorized' }, 401) };

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return { response: json({ error: 'Unauthorized' }, 401) };

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  if ((profile as { role?: string } | null)?.role !== 'admin') {
    return { response: json({ error: 'Admin access required' }, 403) };
  }

  return { user: data.user, admin };
}

async function embedChunks(body: KnowledgeBody, chunks: Array<{ chunk_text: string; section_heading: string | null }>) {
  const provider = body.embeddingProvider === 'deepseek' ? 'deepseek' : body.embeddingProvider === 'openai' ? 'openai' : null;
  const embeddedChunks = [];
  let embeddingProvider = '';
  let embeddingModel = '';

  for (let index = 0; index < chunks.length; index += 1) {
    const embedded = await embedKnowledgeText((name) => Deno.env.get(name) || undefined, fetch, chunks[index].chunk_text, provider);
    if (!embedded) {
      throw new Error(provider === 'deepseek'
        ? 'DeepSeek embeddings require DEEPSEEK_API_KEY and DEEPSEEK_EMBEDDING_MODEL with a compatible embeddings endpoint.'
        : 'OpenAI embeddings require OPENAI_API_KEY.');
    }
    embeddingProvider = embedded.provider;
    embeddingModel = embedded.model;
    embeddedChunks.push({
      ...chunks[index],
      chunk_index: index,
      embedding: vectorLiteral(embedded.embedding),
      token_count: Math.ceil(chunks[index].chunk_text.length / 4),
    });
  }

  return { embeddedChunks, embeddingProvider, embeddingModel };
}

async function listDocuments(admin: AdminClient) {
  const { data: documents, error } = await admin
    .from('knowledge_documents')
    .select('id,title,source_uri,mime_type,status,embedding_provider,embedding_model,created_at,updated_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const ids = (documents || []).map((document: { id: string }) => document.id);
  const chunkCounts: Record<string, number> = {};
  const documentText: Record<string, string[]> = {};
  if (ids.length) {
    const { data: chunks, error: chunksError } = await admin
      .from('knowledge_chunks')
      .select('document_id,chunk_index,chunk_text')
      .in('document_id', ids)
      .order('chunk_index', { ascending: true });
    if (chunksError) throw new Error(chunksError.message);
    (chunks || []).forEach((chunk: { document_id: string; chunk_text?: string }) => {
      chunkCounts[chunk.document_id] = (chunkCounts[chunk.document_id] || 0) + 1;
      documentText[chunk.document_id] = documentText[chunk.document_id] || [];
      if (chunk.chunk_text) documentText[chunk.document_id].push(chunk.chunk_text);
    });
  }

  return (documents || []).map((document: { id: string }) => ({
    ...document,
    chunks_count: chunkCounts[document.id] || 0,
    text: (documentText[document.id] || []).join('\n\n'),
  }));
}

async function ingestDocument(admin: AdminClient, body: KnowledgeBody, uploadedBy: string, documentId?: string) {
  const title = clean(body.title);
  const text = clean(body.text);
  if (!title) throw new Error('Knowledge document title is required');
  if (text.length < 40) throw new Error('Paste at least 40 characters of source knowledge text');

  const chunks = chunkKnowledgeText(text, {
    sectionHeading: body.sectionHeading,
    maxChars: 1200,
    overlapChars: 180,
  });
  if (!chunks.length) throw new Error('No knowledge chunks could be created from this text');

  const { embeddedChunks, embeddingProvider, embeddingModel } = await embedChunks(body, chunks);

  let document: Record<string, unknown> | null = null;
  if (documentId) {
    const { data, error } = await admin
      .from('knowledge_documents')
      .update({
        title,
        source_uri: clean(body.sourceUri) || null,
        mime_type: clean(body.mimeType) || 'text/plain',
        status: 'active',
        embedding_provider: embeddingProvider,
        embedding_model: embeddingModel,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .select('id,title,source_uri,created_at,updated_at')
      .single();
    if (error || !data) throw new Error(error?.message || 'Knowledge document update failed');
    const { error: deleteError } = await admin.from('knowledge_chunks').delete().eq('document_id', documentId);
    if (deleteError) throw new Error(deleteError.message);
    document = data;
  } else {
    const { data, error } = await admin
      .from('knowledge_documents')
      .insert({
        title,
        source_uri: clean(body.sourceUri) || null,
        mime_type: clean(body.mimeType) || 'text/plain',
        embedding_provider: embeddingProvider,
        embedding_model: embeddingModel,
        uploaded_by: uploadedBy,
      })
      .select('id,title,source_uri,created_at,updated_at')
      .single();
    if (error || !data) throw new Error(error?.message || 'Knowledge document insert failed');
    document = data;
  }

  const { error: chunksError } = await admin
    .from('knowledge_chunks')
    .insert(embeddedChunks.map((chunk) => ({
      document_id: document?.id,
      chunk_index: chunk.chunk_index,
      section_heading: chunk.section_heading,
      chunk_text: chunk.chunk_text,
      token_count: chunk.token_count,
      embedding: chunk.embedding,
    })));
  if (chunksError) throw new Error(chunksError.message);

  return { document, chunksInserted: embeddedChunks.length, embeddingProvider, embeddingModel };
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return typeof text === 'string' ? text : (text as string[]).join('\n\n');
}

async function parseRequestBody(request: Request): Promise<KnowledgeBody> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return request.json() as Promise<KnowledgeBody>;
  }

  const form = await request.formData();
  const body: KnowledgeBody = {
    action: (form.get('action') as KnowledgeBody['action']) || 'upload',
    documentId: form.get('documentId') as string | undefined || undefined,
    title: form.get('title') as string | undefined || undefined,
    sourceUri: form.get('sourceUri') as string | undefined || undefined,
    sectionHeading: form.get('sectionHeading') as string | undefined || undefined,
    embeddingProvider: (form.get('embeddingProvider') as KnowledgeBody['embeddingProvider']) || undefined,
  };

  const file = form.get('file') as File | null;
  const extraText = (form.get('text') as string | null)?.trim() || '';
  if (file) {
    const mimeType = file.type || 'application/octet-stream';
    body.mimeType = mimeType;
    if (!body.title) body.title = file.name.replace(/\.[^.]+$/, '');
    const buffer = await file.arrayBuffer();
    let fileText: string;
    if (mimeType === 'application/pdf' || file.name.endsWith('.pdf')) {
      fileText = await extractPdfText(buffer);
      body.mimeType = 'application/pdf';
    } else {
      fileText = new TextDecoder().decode(buffer);
    }
    body.text = extraText ? `${extraText}\n\n${fileText}` : fileText;
  } else if (extraText) {
    body.text = extraText;
  }

  return body;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const auth = await authenticateRequest(request);
    if ('response' in auth) return auth.response;

    const body = await parseRequestBody(request);
    const action = body.action || 'upload';

    if (action === 'list') {
      return json({ documents: await listDocuments(auth.admin) });
    }

    if (action === 'delete') {
      const documentId = clean(body.documentId);
      if (!documentId) return json({ error: 'documentId is required' }, 400);
      const { error } = await auth.admin.from('knowledge_documents').delete().eq('id', documentId);
      if (error) return json({ error: error.message }, 500);
      return json({ deleted: true, documentId });
    }

    if (action === 'update') {
      const documentId = clean(body.documentId);
      if (!documentId) return json({ error: 'documentId is required' }, 400);
      return json(await ingestDocument(auth.admin, body, auth.user.id, documentId));
    }

    if (action === 'seedDefaults') {
      const results = [];
      for (const document of DEFAULT_KNOWLEDGE_DOCUMENTS) {
        const { data: existing } = await auth.admin
          .from('knowledge_documents')
          .select('id')
          .eq('source_uri', document.sourceUri)
          .maybeSingle();
        results.push(await ingestDocument(
          auth.admin,
          { ...document, embeddingProvider: body.embeddingProvider },
          auth.user.id,
          (existing as { id?: string } | null)?.id,
        ));
      }
      return json({ seeded: results.length, results, documents: await listDocuments(auth.admin) });
    }

    return json(await ingestDocument(auth.admin, body, auth.user.id));
  } catch (error) {
    console.error('knowledge-upload failed', error);
    return json({ error: error instanceof Error ? error.message : 'Knowledge operation failed' }, 500);
  }
});
