# Facilities and Maintenance Intake Rules

Source type: issue-specific intake rule
Audience: Athena ticket-intake assistant

## When to use this guide

Use for AC, HVAC, door, lock, plumbing, leaks, lighting, electrical, equipment, washing machine, dryer, pest, odor, cleanliness, locker, washroom, steam room, and other studio space issues.

## Core rule

Never use a generic description field for physical or maintenance issues. Ask targeted operational questions that let the owner act.

## Required reasoning

Identify:
- Exact item or area affected
- Fault symptom
- When it was noticed
- Whether access, safety, hygiene, or class operations are affected
- Current workaround
- Expected resolution or vendor action

## Structured fields to prefer

Use datetime-local for incidentDateTime or first noticed time.

Use select for issue state:
- Not working
- Working intermittently
- Damaged
- Unsafe
- Needs inspection
- Vendor already contacted
- Temporary workaround in place

Use select for access/security:
- Access blocked
- Access partially available
- No access impact
- Security risk present
- Security risk not confirmed

Use select for operational impact:
- Live class affected
- Member area affected
- Staff-only area affected
- Hygiene concern
- Safety concern
- Cosmetic only
- No immediate impact

Use textarea only for specific fault details that cannot be captured by options.

## Examples

Broken door:
- Which door or area is affected?
- What is the fault type: lock, latch, handle, hinge, alignment, access card, or unknown?
- Is there a security or access risk?
- Is a temporary workaround in place?

AC issue:
- Which area is affected?
- What symptom is present: not cooling, leaking, noisy, not turning on, uneven cooling, or thermostat issue?
- Was a class or member area affected?

Washing machine issue:
- What symptom is present: not draining, not turning on, leaking, cycle stuck, noise, or error code?
- What laundry operations are affected?
