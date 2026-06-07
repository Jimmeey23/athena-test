import { describe, expect, it } from 'vitest';
import {
  buildIntakeConversationPlan,
  buildNaturalSingleFieldPrompt,
  limitConversationalFieldBatch,
  serializeConversationPlan,
} from './intake-conversation-plan';

describe('intake conversation planning', () => {
  it('personalizes the plan with the reporter first name', () => {
    const plan = buildIntakeConversationPlan({
      initialText: 'Member said the 6:30 Barre class was affected because the AC stopped cooling.',
      reporterName: 'Priya Shah',
      context: {
        clientsAffected: 'Yes - directly affected',
      },
    });

    expect(plan.reporterFirstName).toBe('Priya');
    expect(plan.openingTone).toContain('Priya');
  });

  it('plans member and class follow-ups when clients and sessions were affected', () => {
    const plan = buildIntakeConversationPlan({
      initialText: 'AC stopped cooling and classes were affected during the evening schedule.',
      reporterName: 'Ayesha Patel',
      context: {
        clientsAffected: 'Yes - directly and indirectly affected',
      },
    });

    expect(plan.followUpFieldIds).toEqual(expect.arrayContaining([
      'memberName',
      'classType',
      'classImpactType',
      'classImpactDetails',
    ]));
    expect(serializeConversationPlan(plan)).toContain('Identify affected member');
    expect(serializeConversationPlan(plan)).toContain('Identify affected class/session');
    expect(serializeConversationPlan(plan)).toContain('Capture how the class/session was affected');
  });

  it('includes the client-impact check even for operational reports', () => {
    const plan = buildIntakeConversationPlan({
      initialText: 'Door lock not closing at Kwality.',
      reporterName: 'Priya Shah',
    });

    expect(plan.followUpFieldIds).toContain('clientsAffected');
    expect(serializeConversationPlan(plan)).toContain('Confirm whether any members were directly or indirectly affected');
  });
});

describe('conversational field batching', () => {
  it('asks client impact by itself when it is still unanswered', () => {
    expect(limitConversationalFieldBatch([
      { id: 'studio', label: 'Studio', type: 'select' },
      { id: 'clientsAffected', label: 'Were any clients affected?', type: 'select' },
      { id: 'incidentDateTime', label: 'When?', type: 'datetime-local' },
    ])).toEqual([
      { id: 'clientsAffected', label: 'Were any clients affected?', type: 'select' },
    ]);
  });

  it('keeps later turns to two fields at most', () => {
    expect(limitConversationalFieldBatch([
      { id: 'studio', label: 'Studio', type: 'select' },
      { id: 'incidentDateTime', label: 'When?', type: 'datetime-local' },
      { id: 'priority', label: 'Priority', type: 'select' },
    ])).toHaveLength(2);
  });

  it('holds the resolution-required question until it is the only remaining field', () => {
    expect(limitConversationalFieldBatch([
      { id: 'description', label: 'Describe the issue', type: 'textarea' },
      { id: 'resolutionRequired', label: 'Does this ticket require a resolution?', type: 'select' },
    ])).toEqual([
      { id: 'description', label: 'Describe the issue', type: 'textarea' },
    ]);

    expect(limitConversationalFieldBatch([
      { id: 'resolutionRequired', label: 'Does this ticket require a resolution?', type: 'select' },
    ])).toEqual([
      { id: 'resolutionRequired', label: 'Does this ticket require a resolution?', type: 'select' },
    ]);
  });
});

describe('natural single-field prompts', () => {
  it('turns compact select questions into chat copy instead of form copy', () => {
    expect(
      buildNaturalSingleFieldPrompt({
        field: {
          id: 'clientsAffected',
          label: 'Were any clients affected?',
          type: 'select',
          options: ['Yes - directly affected', 'No clients affected'],
        },
        reporterFirstName: 'Priya',
      })
    ).toBe('Priya, were any clients affected?');
  });

  it('asks for affected class details in context when a session was impacted', () => {
    expect(
      buildNaturalSingleFieldPrompt({
        field: {
          id: 'classImpactDetails',
          label: 'How was the class/session affected?',
          type: 'textarea',
        },
        reporterFirstName: 'Priya',
      })
    ).toContain('what changed for the affected class/session');
  });

  it('asks the resolution-required gate with the exact required copy', () => {
    expect(
      buildNaturalSingleFieldPrompt({
        field: {
          id: 'resolutionRequired',
          label: 'Does this ticket require a resolution?',
          type: 'select',
          options: ['Yes', 'No'],
        },
      })
    ).toBe('Does this ticket require a resolution?');
  });
});
