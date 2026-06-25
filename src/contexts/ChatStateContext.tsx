import React, { useRef, useState } from 'react';
import { ChatStateContext, type ActiveDraftSummary, type ChatContextValue, type ChatStateContextValue, type PredictedField } from './chat-state-context';

export const ChatStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [chatContext, setChatContext] = useState<ChatContextValue>({});
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [activeDraft, setActiveDraft] = useState<ActiveDraftSummary | null>(null);
  const [predictedFields, setPredictedFields] = useState<PredictedField[]>([]);
  // Callback ref: ChatInterface registers a handler here; sidebar calls it to push context patches back in
  const onSidebarContextChange = useRef<((patch: Partial<ChatContextValue>) => void) | null>(null);

  return (
    <ChatStateContext.Provider value={{
      chatContext,
      setChatContext,
      onSidebarContextChange,
      attachmentCount,
      setAttachmentCount,
      activeDraft,
      setActiveDraft,
      predictedFields,
      setPredictedFields,
    }}>
      {children}
    </ChatStateContext.Provider>
  );
};
