import React, { createContext, useContext, useRef, useState } from 'react';

export interface ChatContextValue {
  studio?: string;
  category?: string;
  subCategory?: string;
  priority?: string;
  memberName?: string;
  memberContact?: string;
  memberId?: string;
  membership?: string;
  classType?: string;
  classDateTime?: string;
  sessionId?: string;
  trainer?: string;
  intakeRoute?: string;
  requestType?: string;
  clientsAffected?: string;
  urgencyReason?: string;
  memberSentiment?: string;
  desiredResolution?: string;
  description?: string;
  incidentDateTime?: string;
  reportedBy?: string;
  assignedTo?: string;
  owner?: string;
  department?: string;
  team?: string;
  initialReport?: string;
  reporterFirstName?: string;
  conversationPlan?: string;
  [key: string]: string | undefined;
}

export interface PredictedField {
  id: string;
  label: string;
  completed: boolean;
}

export interface ActiveDraftSummary {
  title?: string | null;
  category?: string | null;
  subCategory?: string | null;
  priority?: string | null;
  studio?: string | null;
  trainer?: string | null;
  classType?: string | null;
  memberName?: string | null;
  memberContact?: string | null;
  assignedTo?: string | null;
  department?: string | null;
  sentiment?: string;
  conversationSummary?: string;
  tags?: string[];
}

interface ChatStateContextValue {
  chatContext: ChatContextValue;
  setChatContext: React.Dispatch<React.SetStateAction<ChatContextValue>>;
  /** Called by sidebar to push context changes back into ChatInterface */
  onSidebarContextChange: React.MutableRefObject<((patch: Partial<ChatContextValue>) => void) | null>;
  attachmentCount: number;
  setAttachmentCount: React.Dispatch<React.SetStateAction<number>>;
  activeDraft: ActiveDraftSummary | null;
  setActiveDraft: React.Dispatch<React.SetStateAction<ActiveDraftSummary | null>>;
  predictedFields: PredictedField[];
  setPredictedFields: React.Dispatch<React.SetStateAction<PredictedField[]>>;
}

const ChatStateContext = createContext<ChatStateContextValue | null>(null);

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

export function useChatState() {
  const ctx = useContext(ChatStateContext);
  if (!ctx) throw new Error('useChatState must be used within ChatStateProvider');
  return ctx;
}
