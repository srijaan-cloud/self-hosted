// Thin adapter so call sites can keep the same `db.prepare(sql).get/.all/.run(...)`
// shape used by the original better-sqlite3-based code, backed by D1 (async) instead.
export function getDb(env) {
  const d1 = env.DB;
  return {
    prepare(sql) {
      const stmt = d1.prepare(sql);
      return {
        get: async (...args) => (await stmt.bind(...args).first()) ?? undefined,
        all: async (...args) => (await stmt.bind(...args).all()).results,
        run: async (...args) => {
          const res = await stmt.bind(...args).run();
          return { changes: res.meta.changes, lastInsertRowid: res.meta.last_row_id };
        },
      };
    },
  };
}
