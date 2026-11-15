# Course-permissions module

This module replaces `app/lib/access.server.ts` and the role, ownership, Enrollment and country checks that routes make for themselves. Terms are defined in [GLOSSARY.md](../../GLOSSARY.md) under "Course Permissions" and "Purchasing-Power Prices".

Related decisions:

- [ADR-0013: The Granting Purchase decides the country check](../adr/0013-the-granting-purchase-decides-the-country-check.md)
- [ADR-0014: Claimed Seats are country-checked on every visit](../adr/0014-claimed-seats-are-country-checked-on-every-visit.md)
- [ADR-0015: One country rule for claiming a Seat and for taking a course](../adr/0015-one-country-rule-for-claiming-and-taking-a-course.md)

## Design

1. **Location and entry points:** the module lives at `app/modules/course-permissions/`.
   - `index.server.ts` exports `createCoursePermissions(db)` and a ready-made instance for routes.
   - `viewer.server.ts` exports `viewerFromRequest(request)`, which returns `{ userId, country }`.
   - The session cookie and `resolveCountry` are read there and nowhere else. The country is resolved up front, which is cheap because [ADR-0012](../adr/0012-charge-full-price-when-the-country-is-unknown.md) rules out network lookups.
2. **Interface shape:** the module returns Course Permissions (what a person may do on the course), not facts about who they are. Routes never combine role flags themselves.
3. **Two ways to ask:** a decision that never throws, for loaders that show a Lesson Preview, and a `require…` that throws, for actions. There is one 401 message (the DevUI one) and one 403 message per permission.
4. **Who holds each Course Permission:**
   - **Read Lessons:** owning Instructor, Platform Admin, and enrolled Students who aren't Country-Blocked.
   - **Edit the Course:** owning Instructor and Platform Admin.
   - **Moderate:** owning Instructor and Platform Admin.
   - **Record Progress:** enrolled Students who aren't Country-Blocked.
   - **Rate:** anyone with an Enrollment except the owning Instructor. Country-Blocked Students and enrolled Platform Admins can rate.
5. **Bookmarks and Notes** need Read Lessons. Existing ones stay visible on `/saved` whatever the person's permissions.
6. **Owning Instructor or Platform Admin without an Enrollment:** they see the quiz and can submit it to check their answers, but nothing is saved. They get no "mark complete".
7. **Country-Blocked Students:**
   - They get a Lesson Preview with an explanation of the block.
   - They can't record new progress, submit quizzes or comment.
   - They can still rate the course.
   - The outline still shows their past progress.
8. **The module does all lesson reads:**
   - `lesson(viewer, lessonId)` returns the permissions plus either the full lesson or a Lesson Preview.
   - `outline(viewer, courseId)` returns Lesson Preview fields only, for the course, module and welcome pages.
   - No route selects from `lessons` directly.
9. **Lesson Preview** contains the title, length, whether there's a video, and the lesson's place in the outline. It never includes the body, the video URL or the GitHub repo URL.
10. **Platform-level checks:** `platformPermissions(viewer)`, with a matching `require…` for each answer, gives three answers:
    - whether the viewer is a Platform Admin,
    - whether they can open Instructor pages (Instructors and Platform Admins),
    - whether they can create a course (Instructors only).

    It replaces the inline `admin.*` checks, `requirePlatformAdmin`, `requireInstructorOrAdmin`, and the checks in `instructor.tsx` and `instructor.new.tsx`. The Team Admin check in `team.tsx` stays with Seats.
11. **Country rule** (ADRs 0013–0015), the same for claiming a Seat and for taking a course:
    - The check uses the Granting Purchase's Purchase Country. The Granting Purchase is the Student's own unrefunded Individual Purchase or, failing that, the Team Licence behind their Claimed Seat.
    - Full-Price Countries are never restricted.
    - An unknown current country is allowed.
    - Claimed Seats are checked on every visit, not only when claimed.
12. **Tests:**
    - New interface tests run against `createTestDb()`, with no `vi.mock` of the session.
    - The `checkPppAccess` tests in `ppp.test.ts` are rewritten through the module's interface, together with the Granting Purchase and Claimed-Seat cases.
    - The pricing tests and `country.server.test.ts` stay as they are.
13. **Migration order:**
    - Build the module and its tests first.
    - Move routes over one PR at a time, starting with the lesson route, and close the route bugs below as the routes that contain them move.
    - Delete `app/lib/access.server.ts` in the last PR.

## Bugs this fixes

Route bugs, closed as their routes move to the module:

- [#42](https://github.com/spprashaant/software-factories/issues/42): Lesson page sends the full lesson to visitors who can't read it
- [#43](https://github.com/spprashaant/software-factories/issues/43): Course, module and welcome pages send every lesson's content and video URL
- [#44](https://github.com/spprashaant/software-factories/issues/44): `mark-complete` doesn't check access or which course the lesson is in
- [#45](https://github.com/spprashaant/software-factories/issues/45): `submit-quiz` doesn't check access, and `quizId` isn't tied to the lesson
- [#46](https://github.com/spprashaant/software-factories/issues/46): `api.video-tracking` records watch events for any `lessonId`

Country-rule bugs, fixed inside the module:

- [#47](https://github.com/spprashaant/software-factories/issues/47): The country check reads an arbitrary Purchase instead of the Granting Purchase (ADR-0013)
- [#48](https://github.com/spprashaant/software-factories/issues/48): Students with a Claimed Seat are never Country-Blocked after the claim (ADR-0014)
