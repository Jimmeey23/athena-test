import { useContext } from 'react';
import { ChatStateContext } from './chat-state-context';

export function useChatState() {
  const ctx = useContext(ChatStateContext);
  if (!ctx) throw new Error('useChatState must be used within ChatStateProvider');
  return ctx;
}
