import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema";

/**
 * The database services take as their first parameter, so tests can hand in
 * an in-memory one.
 */
export type Db = BetterSQLite3Database<typeof schema>;

/** The handle inside `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Either: for reads that work inside or outside a transaction. */
export type Queryable = Db | Tx;
