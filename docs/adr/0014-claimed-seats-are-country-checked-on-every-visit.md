# Claimed Seats are country-checked on every visit, not only at the claim

A Student whose Granting Purchase is a Team Licence bought at a Purchasing-Power Price can be Country-Blocked, exactly like a Student with a discounted Individual Purchase. The check uses the Team Licence's Purchase Country and runs every time they take the course, as well as when they claim the Seat. A Purchasing-Power Price is only fair in the country it was given for (ADR-0009), and that doesn't change because someone else paid.

## Considered Options

- **Check the country only when the Seat is claimed**: rejected. A Student could claim in the discounted country and then take the course anywhere, which an Individual Purchase doesn't allow.

## Consequences

Today a Student with a Claimed Seat is never Country-Blocked after the claim: they have no Purchase of their own, so the check finds no Purchase Country and lets them through. This bug is tracked in [#48](https://github.com/spprashaant/software-factories/issues/48) and will be fixed by the [course-permissions module](../design/course-permissions.md).
