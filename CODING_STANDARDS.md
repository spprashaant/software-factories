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

## Let the code explain itself

Name and extract until a comment is unnecessary. A comment earns its place
only for a _why_ the code cannot express: a constraint, a decision, a link to
the ADR behind it. A comment that restates _what_ the code does goes stale the
first time the code changes.

## Arrange tests through the module under test

Test setup calls the module's own functions. When the function you need does
not exist, add it to the module rather than inserting rows directly, so a
change to how the module stores its data leaves its tests alone.

## Import a module through its entry points

Code outside a module in `app/modules/` imports only the files at the
module's root, never anything in its `lib/` or `tests/`. The module's tests
follow the same rule. A deep import ties the caller to code the module is free
to rewrite. `npm run lint:boundaries` catches this. The rule is written here
too so you know it before the lint fails.

## Routes do not query the database

`app/routes/instructor.analytics.tsx` does not import `~/db` or
`drizzle-orm`. Its loader asks `~/modules/instructor-analytics` for the page
and returns the result. A query in the route is behaviour that the module's
tests never exercise. `npm run lint:boundaries` enforces this for the
analytics route. Treat it as the rule for any route that a module serves.
