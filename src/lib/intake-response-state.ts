interface MoreInfoState {
  hasDetailForm: boolean;
  remainingMissingFieldCount: number;
  aiNeedsMoreInfo?: boolean;
}

interface AiDetailFormState {
  remainingMissingFieldCount: number;
  aiNeedsMoreInfo?: boolean;
  aiProposedFieldCount?: number;
}

const GENERIC_CATEGORIES = new Set(['', 'General Feedback', 'Miscellaneous']);

export function shouldHoldDraftForMoreInfo(state: MoreInfoState): boolean {
  return state.hasDetailForm;
}

// AI drives the intake. Deterministic missing-field counts are advisory only and
// should not force a form into the conversation.
export function shouldAcceptAiDetailForm(state: AiDetailFormState): boolean {
  return Boolean(state.aiNeedsMoreInfo) && (state.aiProposedFieldCount ?? 0) > 0;
}

export function shouldReplaceInferredCategory(currentCategory?: string, inferredCategory?: string): boolean {
  if (!inferredCategory || inferredCategory === currentCategory) return false;
  if (currentCategory === 'Safety and Security' && inferredCategory === 'Theft and Lost Items') return true;
  return GENERIC_CATEGORIES.has(currentCategory || '');
}

export function shouldAcceptInferredSubCategory(
  currentCategory: string | undefined,
  inferredSubCategory: string | undefined,
  validSubCategories: string[] | undefined
): boolean {
  if (!inferredSubCategory || !currentCategory || !validSubCategories) return true;
  return validSubCategories.includes(inferredSubCategory);
}
