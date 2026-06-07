import { createClient } from '@supabase/supabase-js';

const backendSupabaseUrl = (import.meta.env.VITE_TICKETING_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL) as string;
const backendSupabaseAnonKey = (import.meta.env.VITE_TICKETING_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

if (!backendSupabaseUrl || !backendSupabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Set VITE_TICKETING_SUPABASE_URL and VITE_TICKETING_SUPABASE_ANON_KEY in your environment.'
  );
}
const ticketingFunctionsSupabaseUrl =
  import.meta.env.VITE_TICKET_AI_SUPABASE_URL ||
  import.meta.env.VITE_TICKETING_FUNCTIONS_SUPABASE_URL ||
  backendSupabaseUrl;
const ticketingFunctionsSupabaseAnonKey =
  import.meta.env.VITE_TICKET_AI_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_TICKETING_FUNCTIONS_SUPABASE_ANON_KEY ||
  backendSupabaseAnonKey;

export const backendSupabase = createClient(backendSupabaseUrl, backendSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'p57-ticketing-auth',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export const ticketingFunctionsSupabase = createClient(
  ticketingFunctionsSupabaseUrl,
  ticketingFunctionsSupabaseAnonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);
