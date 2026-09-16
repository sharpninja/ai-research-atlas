import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database(filename = ':memory:', migrate = true) {
  const sql = new DatabaseSync(filename); sql.exec('PRAGMA foreign_keys = ON');
  if (migrate) for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql'))) sql.exec(readFileSync('drizzle/' + file,'utf8'));
  const adapter = {
    sql,
    prepare(query) {
      const statement = sql.prepare(query); let values = [];
      return { bind(...args) {values=args; return this;},
        async first() {return statement.get(...values) || null;},
        async all() {return {results:statement.all(...values)};},
        async run() { const result = statement.run(...values); return {meta:{changes:Number(result.changes)}}; }
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result; }
      catch(error) {sql.exec('ROLLBACK'); throw error;}
    }
  };
  return adapter;
}
