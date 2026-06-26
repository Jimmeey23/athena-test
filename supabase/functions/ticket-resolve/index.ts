import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { callJsonAi } from '../_shared/ai-provider.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESOLUTION_TYPES = new Set([
  'Fixed', 'Escalated', 'Refund Issued', 'Policy Explained', 'No Action Needed', 'Duplicate',
]);

type TicketStatus = 'New' | 'In Progress' | 'Awaiting Member' | 'Resolved' | 'Closed';
type ResolveAction = 'claim' | 'await_member' | 'unblock' | 'resolve';

const TRANSITIONS: Record<ResolveAction, { from: TicketStatus; to: TicketStatus }> = {
  claim:        { from: 'New',             to: 'In Progress' },
  await_member: { from: 'In Progress',     to: 'Awaiting Member' },
  unblock:      { from: 'Awaiting Member', to: 'In Progress' },
  resolve:      { from: 'In Progress',     to: 'Resolved' },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function bearerToken(authorization: string): string {
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

function optionalEnv(...names: string[]): string {
  for (const name of names) {
    const v = Deno.env.get(name);
    if (v) return v;
  }
  return '';
}

function smtpTransport() {
  const port = Number(optionalEnv('MAILTRAP_SMTP_PORT', 'SMTP_PORT') || 2525);
  return nodemailer.createTransport({
    host: Deno.env.get('MAILTRAP_SMTP_HOST') || '',
    port,
    auth: {
      user: Deno.env.get('MAILTRAP_SMTP_USER') || '',
      pass: Deno.env.get('MAILTRAP_SMTP_PASS') || '',
    },
  });
}

async function rewriteResolutionEmail(
  ticketTitle: string,
  resolutionType: string,
  resolutionNote: string,
): Promise<string> {
  const safeTitle = ticketTitle.replace(/[\r\n]/g, ' ');
  try {
    const result = await callJsonAi(
      (name) => Deno.env.get(name) || undefined,
      fetch,
      {
        temperature: 0.3,
        maxTokens: 300,
        systemContent: [
          'You are writing a brief, warm, professional resolution email on behalf of Physique 57 India.',
          'Rewrite the following internal resolution note as a 2-3 sentence member-facing message.',
          'Be specific about what was done. Do not reveal internal routing, assignee names, or ticket IDs.',
          'Sign off as "The Physique 57 India Team".',
          'Return JSON only: {"emailBody": string}',
        ].join('\n'),
        userContent: JSON.stringify({ ticketTitle: safeTitle, resolutionType, resolutionNote }),
      },
    );
    if (!result) return resolutionNote;
    const parsed = JSON.parse(result.content);
    return typeof parsed.emailBody === 'string' && parsed.emailBody.trim()
      ? parsed.emailBody
      : resolutionNote;
  } catch {
    return resolutionNote;
  }
}

async function sendResolutionEmail(
  toEmail: string,
  ticketTitle: string,
  emailBody: string,
): Promise<boolean> {
  const safeTitle = ticketTitle.replace(/[\r\n]/g, ' ');
  const fromEmail = optionalEnv('MAILTRAP_FROM_EMAIL', 'SMTP_FROM_EMAIL') || 'athena@physique57india.com';
  const fromName = optionalEnv('MAILTRAP_FROM_NAME', 'SMTP_FROM_NAME') || 'Physique 57 India';
  try {
    await smtpTransport().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: toEmail,
      subject: `Your report has been resolved: ${safeTitle}`,
      text: emailBody,
    });
    return true;
  } catch (err) {
    console.warn('[ticket-resolve] Email send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('TICKETING_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('TICKETING_SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceRoleKey = Deno.env.get('TICKETING_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Missing Supabase configuration' }, 500);
    }

    const token = bearerToken(request.headers.get('authorization') || '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);
    const authUser = userData.user;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await request.json() as {
      ticketId?: string;
      action?: string;
      resolutionType?: string;
      resolutionNote?: string;
      reporterContacted?: boolean;
    };

    const { ticketId, action } = body;
    if (!ticketId || !action) return json({ error: 'ticketId and action are required' }, 400);
    if (!TRANSITIONS[action as ResolveAction]) return json({ error: `Unknown action: ${action}` }, 400);

    // Fetch ticket
    const { data: ticket, error: fetchError } = await admin
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();
    if (fetchError || !ticket) return json({ error: 'Ticket not found' }, 404);

    // Already resolved/closed guard
    if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
      return json({ error: 'Ticket is already resolved or closed' }, 409);
    }

    // Ownership check (claim is exempt — anyone can claim a New ticket)
    if (action !== 'claim' && ticket.assigned_to !== authUser.email && ticket.assigned_to !== authUser.id) {
      return json({ error: 'Only the assigned owner can perform this action' }, 403);
    }

    // Transition validation
    const t = TRANSITIONS[action as ResolveAction];
    if (ticket.status !== t.from) {
      return json({
        error: `Cannot ${action} a ticket with status "${ticket.status}". Expected "${t.from}".`,
      }, 400);
    }

    // ── RESOLVE ACTION ──────────────────────────────────────────────
    if (action === 'resolve') {
      const { resolutionType, resolutionNote, reporterContacted } = body;

      if (!resolutionType || !RESOLUTION_TYPES.has(resolutionType)) {
        return json({ error: `Invalid resolutionType. Must be one of: ${[...RESOLUTION_TYPES].join(', ')}.` }, 400);
      }
      if (!resolutionNote || resolutionNote.trim().length < 20) {
        return json({ error: 'resolutionNote must be at least 20 characters.' }, 400);
      }
      if (reporterContacted !== true) {
        return json({ error: 'reporterContacted must be true.' }, 400);
      }

      const now = new Date().toISOString();
      const resolutionMeta = {
        type: resolutionType,
        note: resolutionNote.trim(),
        contactedReporter: true,
        resolvedAt: now,
        resolvedBy: authUser.email || authUser.id,
      };

      const existingMeta = ticket.metadata && typeof ticket.metadata === 'object' ? ticket.metadata : {};
      const { data: resolveRows, error: updateError } = await admin
        .from('tickets')
        .update({ status: 'Resolved', metadata: { ...existingMeta, resolution: resolutionMeta } })
        .eq('id', ticketId)
        .eq('status', t.from)
        .select('*');

      if (updateError) return json({ error: updateError.message }, 500);
      if (!resolveRows || resolveRows.length === 0) return json({ error: 'Ticket status changed. Refresh and try again.' }, 409);
      const updated = resolveRows[0];

      const { error: eventError } = await admin.from('ticket_events').insert({
        ticket_id: ticketId,
        event_type: 'status_changed',
        actor: authUser.email || authUser.id,
        from_value: t.from,
        to_value: 'Resolved',
        metadata: { resolutionType, resolvedBy: authUser.email || authUser.id },
        created_by: authUser.id,
      });
      if (eventError) console.warn('[ticket-resolve] ticket_events insert failed:', eventError.message);

      // Email reporter
      let emailSent = false;
      const reporterUid = ticket.created_by as string | null;
      if (reporterUid) {
        const { data: reporterData } = await admin.auth.admin.getUserById(reporterUid);
        const reporterEmail = reporterData?.user?.email;
        if (reporterEmail) {
          const emailBody = await rewriteResolutionEmail(ticket.title, resolutionType, resolutionNote);
          emailSent = await sendResolutionEmail(reporterEmail, ticket.title, emailBody);
          if (!emailSent) {
            console.warn(`[ticket-resolve] Email failed for ticket ${ticketId} → ${reporterEmail}`);
          }
        }
      }

      return json({ ticket: updated, emailSent });
    }

    // ── CLAIM / AWAIT_MEMBER / UNBLOCK ───────────────────────────────
    const patch: Record<string, unknown> = { status: t.to };
    if (action === 'claim') patch.assigned_to = authUser.email || authUser.id;

    const { data: rows, error: updateError } = await admin
      .from('tickets')
      .update(patch)
      .eq('id', ticketId)
      .eq('status', t.from)
      .select('*');

    if (updateError) return json({ error: updateError.message }, 500);
    if (!rows || rows.length === 0) return json({ error: 'Ticket status changed. Refresh and try again.' }, 409);
    const updated = rows[0];

    const { error: eventError } = await admin.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: 'status_changed',
      actor: authUser.email || authUser.id,
      from_value: t.from,
      to_value: t.to,
      metadata: { action },
      created_by: authUser.id,
    });
    if (eventError) console.warn('[ticket-resolve] ticket_events insert failed:', eventError.message);

    return json({ ticket: updated, emailSent: false });

  } catch (err) {
    console.error('[ticket-resolve] Unhandled error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
