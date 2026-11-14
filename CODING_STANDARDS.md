# Coding standards

## Fail with a thrown response, not a return value

A loader or an action that cannot continue throws. It does not return an
error shape for the component to unpack.

```ts
if (!course) throw data("Course not found", { status: 404 });
```

The route then has one success path. A returned error shape gives every
component a second path to forget about.

## Parse untrusted input with a schema

Form data, search parameters and request bodies get a zod schema before the
values reach any query. Do not read `formData.get("x") as string`. The cast
is a lie the type checker believes.

## Do not write `any`, and do not write `!`

Both switch the type checker off at the exact point you are least sure. If a
value can be missing, narrow it with a check. If you cannot name the type,
the shape is wrong — fix the shape.

## Check access in every action intent

Each intent in an action calls the server-side access check its data needs
(`requireContentAccess` for Lesson content), and scopes any posted id to the
resource in the URL. Hiding a control in the UI is not authorization, and a
loader's check does not protect the action beside it.

## Data access lives in `app/lib/*.server.ts`, database first

A query or write belongs to a service module whose functions take `db` as
their first argument, so tests can hand in `createTestDb()`. Routes call
those functions; they don't build queries themselves. When a change needs a
query that only exists as a route-local helper, move the helper into the
service module and call it from both places.

## Validate a business rule in one place

The service function that owns the data owns its limits (lengths, emptiness,
ranges). A route's zod schema parses the shape of the input and passes the
value through. Two copies of a limit drift apart.

## Arrange tests through the app's own functions

Set up test data by calling the same service functions the app uses. If the
function you need doesn't exist yet, add it to the service module rather
than writing `db.insert` in the test. Shared test types such as `TestDb`
come from `~/test/setup`.

## Brand text by its format

A text column holding Markdown is typed `Markdown`, plain text is typed
`PlainText` (`app/lib/text.ts`), set with `.$type<…>()` in the schema. Brand
a value where it enters the system (a zod `.transform(asMarkdown)`, the
service function that writes it), so the type checker refuses to pass plain
text to `renderMarkdown`.

## Comments say why

Names and structure explain what the code does. A comment is for a reason
the code can't express: a constraint, a trade-off, a trap. Write no banner
comments and no JSDoc that restates the function name. A lasting decision
goes in an ADR under `docs/adr/`.

## Labels use glossary terms

Every user-facing label, page title and heading names the GLOSSARY.md
concept it shows. A word on the concept's _Avoid_ list, or a word the
glossary doesn't define, is a finding.
