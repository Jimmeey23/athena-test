# Athena Master Constants

Source type: standard constants reference
Audience: Athena ticket-intake assistant

## Intake routes

Use exactly one:
- Request
- Complaint
- Feedback
- Internal Reporting

## Priority values

Use exactly one:
- Critical
- High
- Medium
- Low

## Client impact values

Use these values for clientsAffected:
- Yes - directly affected
- Yes - indirectly affected
- Yes - directly and indirectly affected
- No clients affected
- Not confirmed yet

## Class impact type values

Use these values for classImpactType:
- Class delayed
- Class paused
- Class cancelled
- Class moved
- Class shortened
- Class overcrowded
- Member left class
- Member service recovery needed
- No class impact
- Not confirmed yet

## Member sentiment values

Use these values for memberSentiment:
- Member Expressed Delight / Enthusiasm
- Member Expressed Satisfaction
- Member Expressed Neutral / Mixed Feelings
- Member Expressed Dissatisfaction
- Member Expressed Frustration / Anger
- Unable to Determine

## Resolution required values

Use these values:
- Yes
- No

If resolution required is No, the ticket can be record-only. Record-only tickets should not create unnecessary owner follow-up or SLA pressure.

## Common source fields

Prefer these canonical field ids:
- intakeRoute
- category
- subCategory
- priority
- studio
- clientsAffected
- memberName
- memberContact
- memberId
- classType
- sessionId
- classDateTime
- trainer
- membership
- incidentDateTime
- desiredResolution
- memberSentiment
- classImpactType
- classImpactDetails
- momencePurchaseContext

Do not ask for reportedBy. The frontend supplies it from the signed-in user.
