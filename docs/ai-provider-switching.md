# AI Provider Switching

The ticket AI edge function supports three providers:

- `deepseek` (default): OpenAI-compatible chat completions via `https://api.deepseek.com`
- `openai`: OpenAI chat completions via `https://api.openai.com/v1`
- `claude`: Anthropic Messages API via `https://api.anthropic.com/v1`

## Frontend

Set the browser-visible provider selector in the root `.env.local`:

```bash
VITE_AI_PROVIDER=openai
```

Accepted values are `deepseek`, `openai`, and `claude`.

## Supabase Edge Function Secrets

Set the matching server-side provider and API key on the Supabase project that hosts
`ticket-ai-chat`.

```bash
supabase secrets set AI_PROVIDER=deepseek DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-v4-pro --project-ref nujgmxqefoumhhreqzxm
supabase secrets set AI_PROVIDER=openai OPENAI_API_KEY=... OPENAI_MODEL=gpt-4o-mini --project-ref nujgmxqefoumhhreqzxm
supabase secrets set AI_PROVIDER=claude ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-3-5-haiku-latest --project-ref nujgmxqefoumhhreqzxm
```

The frontend request can select a provider, but the edge function only succeeds when
the matching API key is configured as a Supabase secret.

## Deployment

Deploy the AI function to the current Supabase project:

```bash
supabase functions deploy ticket-ai-chat --project-ref nujgmxqefoumhhreqzxm
```
