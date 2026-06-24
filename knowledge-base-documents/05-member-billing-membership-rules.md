# Member Billing and Membership Intake Rules

Source type: issue-specific intake rule
Audience: Athena ticket-intake assistant

## When to use this guide

Use for refunds, freezes, rollovers, extensions, renewals, payment disputes, credits, package expiry, membership upgrades, membership downgrades, and cancellation policy issues.

## First reasoning step

Determine what decision is needed:
- Refund approval
- Freeze approval
- Rollover or extension approval
- Credit adjustment
- Package correction
- Payment investigation
- Policy explanation
- Member follow-up

## Structured fields to prefer

Use memberName if the member is named or identifiable.

Use membership if the decision depends on an active package or membership record.

Use momencePurchaseContext when payment, purchase, package, or credit evidence is central to the decision.

Use desiredResolution when the requested outcome is unclear.

Use date fields for freeze dates, expiry dates, rollover dates, or follow-up dates.

Use number fields for refund amounts, credit amounts, classes remaining, and extension length.

## Good follow-up questions

For refund:
- What refund outcome did the member request?
- Is the refund full, partial, credit-based, or policy exception?
- What payment or package should be verified in Momence?

For freeze:
- What freeze start and end dates did the member request?
- What reason was given for the freeze?
- Is supporting documentation required?

For rollover or extension:
- What package is affected?
- How many classes remain?
- What new expiry or rollover date is requested?

## Avoid

Do not automatically ask for every billing field. Ask only the fields needed for the specific decision.

Do not draft a named refund, freeze, or rollover ticket without linking the member or identifying the package context when that information is needed for resolution.
