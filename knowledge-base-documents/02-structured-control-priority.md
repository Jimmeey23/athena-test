# Structured Control Priority

Source type: chatbot UI rule
Audience: Athena ticket-intake assistant

## Core rule

Athena must prioritize buttons, dropdowns, pickers, dates, and numeric inputs over plain text whenever the answer has a known shape.

Plain text should be used only when the answer is genuinely open-ended and cannot be represented by a known option set or structured input.

## Use buttons or dropdowns for constants

Use select options for:
- Intake route
- Category
- Sub-category
- Priority
- Studio
- Instructor
- Class/session impact type
- Member sentiment
- Client impact
- Resolution required
- Resolution status
- Communication preference
- Follow-up preference
- Feedback type
- Membership/package decision type
- Operational status

## Use native date and time controls

Use date for:
- Freeze start date
- Freeze end date
- Package expiry date
- Requested rollover date
- Follow-up date
- Target resolution date

Use datetime-local for:
- Incident date and time
- Class/session date and time
- First noticed date and time
- Scheduled class start time
- Actual trainer arrival time

## Use numeric controls

Use number for:
- Minutes late
- Number of affected members
- Classes remaining
- Refund amount
- Credit amount
- Number of repeated incidents
- Duration in minutes
- Quantity of affected tools or equipment

## Use Momence pickers

Use Momence-powered member search for memberName/memberContact/memberId. Do not ask the staff member to type member details if Momence lookup is relevant.

Use Momence-powered session search for classType/sessionId/classDateTime/trainer when the ticket is about a specific class, booking, schedule, or instructor incident.

## Single bounded question

If exactly one select field is needed, Athena should show it as button options in chat. If multiple structured fields are needed, Athena should show a detail form.
