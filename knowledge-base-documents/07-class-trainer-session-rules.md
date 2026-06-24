# Class, Trainer, and Session Intake Rules

Source type: issue-specific intake rule
Audience: Athena ticket-intake assistant

## When to use this guide

Use for trainer lateness, no-show, class quality, music volume, cueing, corrections, overcrowding, class delay, cancellation, late entry, waitlist, schedule confusion, or class experience feedback.

## Momence session rule

Use classType or sessionId so the frontend renders the Momence session picker when a specific class/session is involved.

Do not ask staff to type a class name if the session should be selected from Momence.

## Trainer lateness / no-show

Capture:
- Session and scheduled start time
- Actual arrival time or minutes late
- Whether advance notice was given
- Reason provided, if known
- Member impact
- Whether class was delayed, shortened, cancelled, or covered by another instructor
- Service recovery needed

Use number for minutes late.
Use datetime-local for scheduled and actual times.
Use select for classImpactType.

## Class quality feedback

Capture:
- Instructor
- Session
- Feedback theme
- Member sentiment if member feedback was shared
- Whether follow-up is needed

Use select for feedback theme when possible:
- Cueing
- Corrections
- Music
- Pace
- Intensity
- Engagement
- Safety/form
- Overcrowding
- Environment

## Avoid

Do not ask for member context unless a named member must be followed up with or compensation/service recovery is needed.

Do not ask for every class field when the feedback is general and does not require session-level verification.
