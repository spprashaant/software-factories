# One country rule for claiming a Seat and for taking a course

Claiming a Seat and taking a course apply the same country rule:

- **Purchase in a Full-Price Country:** no country restriction at all.
- **Discounted Purchase, current country known:** the current country must match the Granting Purchase's Purchase Country.
- **Discounted Purchase, current country unknown:** allowed.

Before this decision the two disagreed. A Seat claim checked the country for every Team Licence, full-price ones included, and refused a Student whose country was unknown. Taking the course did neither.

## Considered Options

- **Block discounted Purchases when the current country is unknown**: rejected. Following ADR-0012, missing country data shouldn't cost anyone. That ADR gives full price when the country is unknown at sale; this one gives access when it's unknown at the check.
- **Keep separate rules for claiming and taking**: rejected. The same Student could be refused a Seat they would be allowed to use.

## Consequences

- A Team Licence bought in a Full-Price Country can now be claimed from any country.
- A request that doesn't come through Cloudflare has no `CF-IPCountry` header. It is never Country-Blocked, so outside production the check does nothing.
