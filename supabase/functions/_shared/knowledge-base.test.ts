import { describe, expect, it, vi } from 'vitest';
import {
  buildKnowledgeSearchText,
  chunkKnowledgeText,
  embedKnowledgeText,
  formatKnowledgeContext,
  resolveKnowledgeEmbeddingConfig,
} from './knowledge-base';

describe('knowledge-base helpers', () => {
  it('chunks pasted knowledge text with overlap and section metadata', () => {
    const text = [
      'Refund policy: members can request review within seven days. The owner should verify the payment trail, package terms, prior communication, and exception approval before confirming the response.',
      'Freeze policy: medical freezes require documentation before approval. The team should capture requested dates, package expiry, classes remaining, member reason, and manager decision in the ticket.',
      'Class recovery: late instructor arrivals require owner follow-up. The ticket should record scheduled start time, actual arrival time, member impact, service recovery offered, and whether any member walked out.',
      'Facility troubleshooting: access issues should capture the exact door or lock, current access status, security risk, workaround, vendor status, and expected repair timeline before assignment.',
    ].join('\n\n');

    const chunks = chunkKnowledgeText(text, {
      maxChars: 500,
      overlapChars: 80,
      sectionHeading: 'Policies',
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.section_heading === 'Policies')).toBe(true);
    expect(chunks[0].chunk_text).toContain('Refund policy');
  });

  it('formats knowledge snippets with source titles for citation', () => {
    const formatted = formatKnowledgeContext([
      {
        document_title: 'Membership SOP',
        section_heading: 'Freeze requests',
        chunk_text: 'Medical freezes require documentation before approval.',
        source_uri: 'https://example.test/sop',
      },
    ]);

    expect(formatted).toContain('Athena knowledge context');
    expect(formatted).toContain('Membership SOP - Freeze requests');
    expect(formatted).toContain('Medical freezes require documentation');
  });

  it('builds a compact search query from the latest user message and context', () => {
    const query = buildKnowledgeSearchText({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'What are we logging?' },
        { role: 'user', content: 'A member wants a freeze extension' },
      ],
      context: {
        category: 'Pricing and Memberships',
        subCategory: 'Membership Pause and Freeze Policy',
      },
    });

    expect(query).toContain('A member wants a freeze extension');
    expect(query).toContain('Membership Pause and Freeze Policy');
    expect(query).not.toContain('What are we logging');
  });

  it('resolves OpenAI embeddings by default and DeepSeek when explicitly configured', () => {
    const openai = resolveKnowledgeEmbeddingConfig((name) => ({
      OPENAI_API_KEY: 'openai-key',
    }[name]));
    expect(openai?.provider).toBe('openai');
    expect(openai?.model).toBe('text-embedding-3-small');

    const deepseek = resolveKnowledgeEmbeddingConfig((name) => ({
      KNOWLEDGE_EMBEDDING_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'deepseek-key',
      DEEPSEEK_EMBEDDING_MODEL: 'deepseek-embedding',
    }[name]));
    expect(deepseek?.provider).toBe('deepseek');
    expect(deepseek?.model).toBe('deepseek-embedding');
  });

  it('calls an OpenAI-compatible embeddings endpoint without exposing the key', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await embedKnowledgeText((name) => ({
      OPENAI_API_KEY: 'secret-key',
      OPENAI_EMBEDDING_DIMENSIONS: '3',
    }[name]), fetcher, 'refund policy');

    expect(result?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result?.provider).toBe('openai');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
      }),
    );
  });
});
