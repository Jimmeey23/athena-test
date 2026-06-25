import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, FileText, Pencil, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { useBackendAuth } from '@/contexts/useBackendAuth';
import { backendSupabase, ticketingFunctionsSupabase } from '@/lib/backend-supabase';
import { withTimeout } from '@/lib/ticketing-functions';

type KnowledgeDocument = {
  id: string;
  title: string;
  source_uri?: string | null;
  mime_type?: string | null;
  status?: string | null;
  embedding_provider?: string | null;
  embedding_model?: string | null;
  created_at?: string;
  updated_at?: string;
  chunks_count?: number;
  text?: string;
};

type KnowledgeResponse = {
  documents?: KnowledgeDocument[];
  document?: KnowledgeDocument;
  chunksInserted?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  seeded?: number;
  deleted?: boolean;
  error?: string;
  details?: string;
};

type FormState = {
  documentId: string;
  title: string;
  sourceUri: string;
  sectionHeading: string;
  text: string;
  embeddingProvider: 'auto' | 'openai' | 'deepseek';
};

const MIN_TEXT_LENGTH = 40;

const EMPTY_FORM: FormState = {
  documentId: '',
  title: '',
  sourceUri: '',
  sectionHeading: '',
  text: '',
  embeddingProvider: 'auto',
};

async function callKnowledge(body: Record<string, unknown> | FormData, timeoutMs = 90000) {
  const { data: sessionData } = await backendSupabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const invokeOptions = body instanceof FormData
    ? { body, headers }
    : { body, headers };

  const { data, error } = await withTimeout(
    ticketingFunctionsSupabase.functions.invoke<KnowledgeResponse>('knowledge-upload', invokeOptions),
    timeoutMs,
    'Knowledge operation timed out while creating embeddings.',
  );

  if (error) {
    // Try to extract the actual error message from the response body
    const message = (error as { context?: Response }).context instanceof Response
      ? await (error as { context: Response }).context.json().then((r: { error?: string; details?: string }) => r.details || r.error).catch(() => error.message)
      : error.message;
    throw new Error(message || 'Knowledge operation failed.');
  }
  if (data?.error) {
    throw new Error(data.details || data.error);
  }
  return data || {};
}

function formatDate(value?: string) {
  if (!value) return 'Not synced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export const KnowledgeBasePanel: React.FC = () => {
  const { accessRole } = useBackendAuth();
  const isAdmin = accessRole === 'admin';
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = selectedFile != null || form.text.trim().length >= MIN_TEXT_LENGTH;
  const canSubmit = isAdmin && form.title.trim().length > 1 && hasContent && !saving;
  const editing = Boolean(form.documentId);
  const activeCount = useMemo(() => documents.filter((document) => document.status !== 'archived').length, [documents]);

  const loadDocuments = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError('');
    try {
      const data = await callKnowledge({ action: 'list' }, 30000);
      setDocuments(data.documents || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Knowledge list failed.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      let payload: Record<string, unknown> | FormData;
      if (selectedFile) {
        const fd = new FormData();
        fd.append('action', editing ? 'update' : 'upload');
        if (editing) fd.append('documentId', form.documentId);
        fd.append('title', form.title.trim());
        if (form.sourceUri.trim()) fd.append('sourceUri', form.sourceUri.trim());
        if (form.sectionHeading.trim()) fd.append('sectionHeading', form.sectionHeading.trim());
        fd.append('embeddingProvider', form.embeddingProvider);
        fd.append('file', selectedFile);
        payload = fd;
      } else {
        payload = {
          action: editing ? 'update' : 'upload',
          documentId: editing ? form.documentId : undefined,
          title: form.title.trim(),
          sourceUri: form.sourceUri.trim() || undefined,
          sectionHeading: form.sectionHeading.trim() || undefined,
          text: form.text.trim(),
          embeddingProvider: form.embeddingProvider,
        };
      }
      const data = await callKnowledge(payload);
      setStatus(`${editing ? 'Updated' : 'Uploaded'} ${data.chunksInserted || 0} chunks using ${data.embeddingProvider} / ${data.embeddingModel}.`);
      setForm(EMPTY_FORM);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadDocuments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Knowledge upload failed.');
    } finally {
      setSaving(false);
    }
  };

  const seedDefaults = async () => {
    if (!isAdmin || seeding) return;
    setSeeding(true);
    setError('');
    setStatus('');
    try {
      const data = await callKnowledge({
        action: 'seedDefaults',
        embeddingProvider: form.embeddingProvider,
      }, 180000);
      setStatus(`Seeded ${data.seeded || 0} Athena default knowledge documents.`);
      setDocuments(data.documents || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Default knowledge seed failed.');
    } finally {
      setSeeding(false);
    }
  };

  const editDocument = (document: KnowledgeDocument) => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setForm({
      documentId: document.id,
      title: document.title || '',
      sourceUri: document.source_uri || '',
      sectionHeading: '',
      text: document.text || '',
      embeddingProvider: 'auto',
    });
    setStatus('Edit the document text below, then save to re-embed it.');
  };

  const deleteDocument = async (document: KnowledgeDocument) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete "${document.title}" from Athena knowledge?`)) return;
    setError('');
    setStatus('');
    try {
      await callKnowledge({ action: 'delete', documentId: document.id }, 30000);
      setStatus(`Deleted "${document.title}".`);
      await loadDocuments();
      if (form.documentId === document.id) { setForm(EMPTY_FORM); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Knowledge delete failed.');
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-600">
        Knowledge base management is available to admin users only.
      </div>
    );
  }

  return (
    <div className="grid w-full gap-4">
      <div className="rounded-2xl border border-slate-200 bg-white/88 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600">
              <BookOpen className="h-3.5 w-3.5" />
              Athena knowledge
            </div>
            <h3 className="mt-1 text-lg font-semibold text-stone-950">Knowledge documents</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Manage source documents Athena retrieves during chat for SOPs, constants, routing, and resolution rules.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadDocuments}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={seedDefaults}
              disabled={seeding}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              {seeding ? 'Seeding...' : 'Seed Athena defaults'}
            </button>
          </div>
        </div>

        {(error || status) && (
          <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || status}
          </div>
        )}

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Active library
              </div>
              <div className="text-xs font-semibold text-slate-600">{activeCount} active / {documents.length} total</div>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              {documents.length ? documents.map((document) => (
                <div key={document.id} className="grid gap-3 border-b border-slate-100 p-3 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-950">{document.title}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-medium text-slate-500">
                      <span>{document.chunks_count || 0} chunks</span>
                      <span>{document.embedding_provider || 'provider'} / {document.embedding_model || 'model'}</span>
                      <span>Updated {formatDate(document.updated_at || document.created_at)}</span>
                    </div>
                    {document.source_uri && <div className="mt-1 truncate text-[11px] text-slate-400">{document.source_uri}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => editDocument(document)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDocument(document)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              )) : (
                <div className="p-6 text-center text-sm font-medium text-slate-500">
                  No knowledge documents found. Seed Athena defaults or upload a source document.
                </div>
              )}
            </div>
          </div>

          <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{editing ? 'Edit document' : 'Upload document'}</div>
                <div className="mt-1 text-sm font-semibold text-slate-950">{editing ? form.title || 'Selected document' : 'New knowledge source'}</div>
              </div>
              {editing && (
                <button type="button" onClick={() => { setForm(EMPTY_FORM); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
                  Cancel edit
                </button>
              )}
            </div>

            <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
              Document title
              <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" required />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
              Source URL or reference
              <input value={form.sourceUri} onChange={(event) => setForm((current) => ({ ...current, sourceUri: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            <div className="grid gap-1.5">
              <div className="text-xs font-semibold text-stone-600">Upload file <span className="font-normal text-slate-400">(PDF, TXT, MD — optional)</span></div>
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-3 py-2.5 transition ${selectedFile ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'}`}>
                <FileText className={`h-4 w-4 shrink-0 ${selectedFile ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                  {selectedFile ? selectedFile.name : 'Choose a file or drag and drop'}
                </span>
                {selectedFile && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="shrink-0 text-[10px] font-semibold text-slate-500 hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,text/plain,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setSelectedFile(file);
                    if (file && !form.title.trim()) {
                      setForm((current) => ({ ...current, title: file.name.replace(/\.[^.]+$/, '') }));
                    }
                  }}
                />
              </label>
              {selectedFile && <p className="text-[11px] text-slate-400">File will be sent to the edge function for text extraction and embedding.</p>}
            </div>
            <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
              Section heading
              <input value={form.sectionHeading} onChange={(event) => setForm((current) => ({ ...current, sectionHeading: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
              Embeddings provider
              <select value={form.embeddingProvider} onChange={(event) => setForm((current) => ({ ...current, embeddingProvider: event.target.value as FormState['embeddingProvider'] }))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                <option value="auto">Auto default</option>
                <option value="openai">OpenAI</option>
                <option value="deepseek">DeepSeek compatible</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
              Knowledge text {selectedFile && <span className="font-normal text-slate-400">(optional — file takes precedence)</span>}
              <textarea value={form.text} onChange={(event) => setForm((current) => ({ ...current, text: event.target.value }))} rows={selectedFile ? 4 : 14} className="rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed text-stone-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" placeholder={editing ? 'Paste the revised full document text before saving.' : selectedFile ? 'Optional additional context to prepend to the file content.' : 'Paste SOPs, policy notes, troubleshooting steps, response templates, or operational resolutions here.'} />
            </label>
            <button type="submit" disabled={!canSubmit} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white shadow-[0_14px_30px_rgba(37,99,235,0.18)] transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? 'Embedding...' : editing ? 'Save and re-embed' : 'Upload knowledge'}
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
