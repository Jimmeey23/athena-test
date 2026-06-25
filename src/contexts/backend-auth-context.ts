import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export type AccessRole = 'admin' | 'support';

export interface BackendProfile {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role?: string | null;
  team?: string | null;
}

export interface BackendAuthContextValue {
  session: Session | null;
  user: User | null;
  profile: BackendProfile | null;
  accessRole: AccessRole;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const BackendAuthContext = createContext<BackendAuthContextValue | null>(null);
