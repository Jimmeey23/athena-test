export type KnowledgeEmbeddingProvider = 'openai' | 'deepseek';

export type KnowledgeChunk = {
  document_id?: string;
  document_title: string;
  section_heading?: string | null;
  chunk_text: string;
  source_uri?: string | null;
  similarity?: number | null;
};

type EnvReader = (name: string) => string | undefined;

type Fetcher = typeof fetch;

type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
  sectionHeading?: string | null;
};

export type KnowledgeEmbeddingConfig = {
  provider: KnowledgeEmbeddingProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  dimensions: number;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeProvider(value?: string | null): KnowledgeEmbeddingProvider {
  const normalized = clean(value).toLowerCase();
  return normalized === 'deepseek' ? 'deepseek' : 'openai';
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function chunkKnowledgeText(text: string, options: ChunkOptions = {}): Array<{ chunk_text: string; section_heading: string | null }> {
  const maxChars = Math.max(500, options.maxChars || 1200);
  const overlapChars = Math.max(0, Math.min(options.overlapChars || 180, Math.floor(maxChars / 3)));
  const paragraphs = splitIntoParagraphs(text);
  const chunks: Array<{ chunk_text: string; section_heading: string | null }> = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (value) {
      chunks.push({
        chunk_text: value,
        section_heading: clean(options.sectionHeading) || null,
      });
    }
    current = '';
  };

  for (const paragraph of paragraphs.length ? paragraphs : [clean(text)]) {
    if (!paragraph) continue;

    if (paragraph.length > maxChars) {
      flush();
      for (let start = 0; start < paragraph.length; start += maxChars - overlapChars) {
        const chunk = paragraph.slice(start, start + maxChars).trim();
        if (chunk) {
          chunks.push({
            chunk_text: chunk,
            section_heading: clean(options.sectionHeading) || null,
          });
        }
        if (start + maxChars >= paragraph.length) break;
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars) {
      const overlap = current.slice(Math.max(0, current.length - overlapChars)).trim();
      flush();
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}

export function buildKnowledgeSearchText(input: {
  messages?: Array<{ role?: string; content?: string }>;
  context?: Record<string, unknown>;
}): string {
  const latestUser = [...(input.messages || [])].reverse().find((message) => message.role === 'user')?.content || '';
  const context = input.context || {};
  return [
    latestUser,
    clean(context.initialReport),
    clean(context.category),
    clean(context.subCategory),
    clean(context.description),
    clean(context.desiredResolution),
  ].filter(Boolean).join('\n');
}

export function formatKnowledgeContext(chunks: KnowledgeChunk[], maxChunks = 5): string {
  const usable = chunks
    .filter((chunk) => clean(chunk.chunk_text))
    .slice(0, maxChunks);
  if (!usable.length) return '';

  const rendered = usable.map((chunk, index) => {
    const heading = clean(chunk.section_heading);
    const source = [chunk.document_title, heading].filter(Boolean).join(' - ');
    const uri = clean(chunk.source_uri);
    const citation = uri ? `${source} (${uri})` : source;
    return `[${index + 1}] ${citation}\n${chunk.chunk_text.trim()}`;
  });

  return [
    'Athena knowledge context:',
    'Use these source excerpts only when they are relevant to the user request. Do not force them into unrelated tickets. When used, cite the source title in the reply or recommended resolution steps.',
    ...rendered,
  ].join('\n\n');
}

export function resolveKnowledgeEmbeddingConfig(env: EnvReader, requestedProvider?: string | null): KnowledgeEmbeddingConfig | null {
  const provider = normalizeProvider(requestedProvider || env('KNOWLEDGE_EMBEDDING_PROVIDER'));

  if (provider === 'deepseek') {
    const apiKey = clean(env('DEEPSEEK_API_KEY'));
    const model = clean(env('DEEPSEEK_EMBEDDING_MODEL'));
    if (!apiKey || !model) return null;
    return {
      provider,
      apiKey,
      model,
      baseUrl: trimTrailingSlash(clean(env('DEEPSEEK_BASE_URL')) || 'https://api.deepseek.com'),
      dimensions: Number(clean(env('DEEPSEEK_EMBEDDING_DIMENSIONS'))) || 1536,
    };
  }

  const apiKey = clean(env('OPENAI_API_KEY'));
  if (!apiKey) return null;
  return {
    provider: 'openai',
    apiKey,
    model: clean(env('OPENAI_EMBEDDING_MODEL')) || 'text-embedding-3-small',
    baseUrl: trimTrailingSlash(clean(env('OPENAI_BASE_URL')) || 'https://api.openai.com/v1'),
    dimensions: Number(clean(env('OPENAI_EMBEDDING_DIMENSIONS'))) || 1536,
  };
}

export async function embedKnowledgeText(
  env: EnvReader,
  fetcher: Fetcher,
  text: string,
  requestedProvider?: string | null,
): Promise<{ embedding: number[]; provider: KnowledgeEmbeddingProvider; model: string; dimensions: number } | null> {
  const config = resolveKnowledgeEmbeddingConfig(env, requestedProvider);
  const input = clean(text);
  if (!config || !input) return null;

  const response = await fetcher(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input,
      dimensions: config.dimensions,
    }),
  });

  if (!response.ok) {
    console.error(`${config.provider} embedding request failed`, response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === 'number')) return null;

  return {
    embedding,
    provider: config.provider,
    model: config.model,
    dimensions: config.dimensions,
  };
}
