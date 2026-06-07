import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('template form dialog layout', () => {
  it('overrides the shared dialog max width cap for template forms', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');
    const templateDialogMatch = source.match(/<DialogContent className="([^"]*z-\[100\][^"]*)">/);

    expect(templateDialogMatch?.[1]).toContain('!w-[min(1440px,calc(100vw-2rem))]');
    expect(templateDialogMatch?.[1]).toContain('!max-w-[min(1440px,calc(100vw-2rem))]');
  });

  it('uses a short warm personalized first message', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain("`Hey ${firstName}! 👋 What would you like to log today? Just describe what happened and I'll handle the rest.`");
    expect(source).toContain('"Hey! I\'m Athena 👋 What would you like to log today? Tell me what happened and I\'ll take it from there."');
    expect(source).not.toContain('your ticket intake assistant.\\n\\nTell me what happened');
  });

  it('uses a dropdown multi-select for Momence sessions instead of a search input', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain('const MomenceSessionDropdownField: React.FC');
    expect(source).toContain('<MultiSelectDropdown');
    expect(source).toContain('loading && dropdownOptions.length === 0');
    expect(source).toContain('First sessions ready');
    expect(source).not.toContain('disabled={dropdownOptions.length === 0}');
    expect(source).not.toContain('placeholder="Search Momence sessions by class, instructor, studio, or date"');
  });

  it('passes private Momence session type explicitly from the hosted class template', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain("const HOSTED_CLASS_SESSION_TYPES = ['private']");
    expect(source).toContain('sessionTypes={HOSTED_CLASS_SESSION_TYPES}');
    expect(source).toContain("loadMomenceSessionsProgressively('', { types: sessionTypes }");
    expect(source).toContain('momenceSessionDropdownCacheKey(sessionTypes)');
  });

  it('keeps the hosted class form arranged as a polished operational template', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain('Hosted template progress');
    expect(source).toContain('Selected session');
    expect(source).toContain('Partnership context');
    expect(source).toContain('Feedback and follow-up');
    expect(source).toContain('grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]');
    expect(source).toContain('Session required');
    expect(source).toContain('Member feedback required');
  });

  it('routes generic templates through Momence-aware member and session controls', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain('const templateDetailFormFromTemplate');
    expect(source).toContain('<DetailCaptureForm');
    expect(source).toContain("title: `${template.label} details`");
    expect(source).toContain('onSubmit={(values, form) => {');
  });

  it('selects a Momence session before mapping member choices from session bookings', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');
    const sessionIndex = source.indexOf('{showTopSessionPicker && (');
    const memberIndex = source.indexOf('{hasMemberFields && (');

    expect(sessionIndex).toBeGreaterThan(-1);
    expect(memberIndex).toBeGreaterThan(-1);
    expect(sessionIndex).toBeLessThan(memberIndex);
    expect(source).toContain('getMomenceSessionBookings(sessionId)');
    expect(source).toContain('const SessionBookingMemberField: React.FC');
    expect(source).toContain('Select members booked into this Momence session');
  });

  it('renders instructor assessments with Momence session mapping, sections, rating controls, and a weighted score', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain("form.id === 'trainer-class-assessment'");
    expect(source).toContain('const AssessmentSessionDetailsField: React.FC');
    expect(source).toContain('Momence mapped');
    expect(source).not.toContain('Custom practice session');
    expect(source).not.toContain('Class date and start time *');
    expect(source).toContain('const RatingControl: React.FC');
    expect(source).toContain('scoreOutOf100');
    expect(source).toContain('evaluationScore');
  });

  it('keeps ticket capture surfaces on Momence-backed member and session fields', () => {
    const files = [
      'src/components/ticketing/ContextPicker.tsx',
      'src/components/ticketing/TicketDashboard.tsx',
      'src/components/ticketing/TicketDetailDrawer.tsx',
      'src/components/ticketing/TicketPreviewCard.tsx',
      'src/components/ticketing/ChatInterface.tsx',
    ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'));
    const source = files.join('\n');

    expect(source).toContain('MomenceMemberTicketField');
    expect(source).toContain('MomenceSessionTicketField');
    expect(source).toContain('MomenceSessionDropdownField');
    expect(source).not.toContain('options={CLASS_TYPES}');
    expect(source).not.toContain('values={[\'\', ...CLASS_TYPES]}');
    expect(source).not.toContain('EditInput label="Class / Session"');
    expect(source).not.toContain('EditInput label="Member"');
    expect(source).not.toContain('EditInput label="Member contact"');
  });

  it('gives every template text input and textarea at least three suggestions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain('suggestionsForTemplateTextField');
    expect(source).toContain('SuggestionChips');
    expect(source).toContain('<SuggestionChips suggestions={suggestionsForTemplateTextField(label)} onPick={onChange} />');
    expect(source).toContain('<SuggestionChips suggestions={suggestionsForDetailField(field)} onPick={(suggestion) => setValue(id, suggestion)} />');
  });

  it('keeps the ticket review structure compact and grouped by decision area', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/TicketPreviewCard.tsx'), 'utf8');

    expect(source).toContain('Decision Summary');
    expect(source).toContain('SmartOpsReviewStrip');
    expect(source).toContain('grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.6fr)]');
    expect(source).not.toContain('lg:grid-cols-[180px_minmax(0,1fr)]');
  });

  it('keeps live context controls before template and text-to-ticket actions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');
    const contextIndex = source.indexOf('<ContextPicker');
    const templateIndex = source.indexOf('<TemplatePicker onSelect={applyTemplate} />', contextIndex);
    const textToTicketIndex = source.indexOf('Text to ticket', templateIndex);

    expect(contextIndex).toBeGreaterThan(-1);
    expect(templateIndex).toBeGreaterThan(contextIndex);
    expect(textToTicketIndex).toBeGreaterThan(templateIndex);
  });

  it('uses an inline optimize prompt icon instead of a visible copilot suggestion strip', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain('optimizeIntakePromptForAthena(input');
    expect(source).toContain('aria-label="Optimise prompt for Athena"');
    expect(source).not.toContain('>Copilot</span>');
    expect(source).not.toContain('intakeCopilot.suggestions');
  });

  it('renders the Athena model badge from the configured provider instead of a stale GPT label', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ticketing/ChatInterface.tsx'), 'utf8');

    expect(source).toContain('aiProviderBadgeLabel');
    expect(source).not.toContain('gpt-4o-mini');
  });
});
