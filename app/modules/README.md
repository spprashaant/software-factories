# Modules

Each folder in `app/modules/` is a deep module: a lot of behaviour behind a
small interface. The files at a module's root are its entry points. Everything
in a subfolder is hidden.

```
app/modules/
  <name>/
    index.server.ts   ← an entry point. Import this from outside.
    client.ts         ← another entry point, if the module needs one.
    lib/              ← implementation. Hidden from outside.
    tests/            ← tests, which import only the entry points.
```

Import a module only through its entry points:
`~/modules/instructor-analytics/index.server`, never
`~/modules/instructor-analytics/lib/...`.

Don't write barrel files. A barrel re-exports a whole subtree through one
`index`. Give a module several small entry points instead, each exporting
only what its callers need.

## The rules

`npm run lint:boundaries` runs dependency-cruiser (`.dependency-cruiser.cjs`)
over `app/`. `npm run check` runs it along with typecheck and tests.

**Entry-point boundary.** Code outside a module (routes, `app/lib`, other
modules) may import a module's root files and nothing in its subfolders.

**Intra-module freedom.** A module's own files import each other freely,
including files in its `lib/`.

**Tests through the entry points.** Files in `<name>/tests/` may import any
module's entry points and their own `tests/` fixtures. They may not import
any module's internals, including their own `lib/`. A test that needs its own
database builds the module from it through the entry point (see
`createInstructorAnalytics` in `instructor-analytics/index.server.ts`).

**No cycles.** No dependency cycles inside `app/modules/`.

Any subfolder counts as private, so adding a folder needs no config change.
Modules are flat: a module may not contain another module.
