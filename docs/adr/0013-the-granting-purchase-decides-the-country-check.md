# The Granting Purchase decides the country check

An Enrollment doesn't record which Purchase granted it (ADR-0004), so the country check works it out: the Granting Purchase is the Student's own Individual Purchase of the course that hasn't been refunded, or, if there isn't one, the Team Licence behind their Claimed Seat. Only the Granting Purchase's country counts. A Team Licence the Student bought for others never does, because it gave them no Enrollment.

## Considered Options

- **Allow the Student if any Purchase or Seat they hold would allow them**: rejected. It's more generous, but a Student could keep a discounted, country-locked Enrollment open by also holding an unrelated Purchase, and nobody could say which Purchase their Enrollment rests on.

## Consequences

The current check reads whichever of the Student's Purchases of the course the database returns first, with no ordering and no filter on kind or refund status. A Student refunded on a discounted Purchase who then bought again at full price can be blocked against the old country. This bug is tracked in [#47](https://github.com/spprashaant/software-factories/issues/47) and will be fixed by the [course-permissions module](../design/course-permissions.md).
