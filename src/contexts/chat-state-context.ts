import { createContext } from 'react';

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

export interface ChatStateContextValue {
  chatContext: ChatContextValue;
  setChatContext: React.Dispatch<React.SetStateAction<ChatContextValue>>;
  onSidebarContextChange: React.MutableRefObject<((patch: Partial<ChatContextValue>) => void) | null>;
  attachmentCount: number;
  setAttachmentCount: React.Dispatch<React.SetStateAction<number>>;
  activeDraft: ActiveDraftSummary | null;
  setActiveDraft: React.Dispatch<React.SetStateAction<ActiveDraftSummary | null>>;
  predictedFields: PredictedField[];
  setPredictedFields: React.Dispatch<React.SetStateAction<PredictedField[]>>;
}

export const ChatStateContext = createContext<ChatStateContextValue | null>(null);
