/**
 * Finds the client-facing endpoints a resolver or controller declares, so the
 * validator can check each one is mentioned somewhere in the knowledge base.
 * NestJS code-first: `@Query(() => X, {name: 'foo'}) bar()` exposes "foo",
 * without a name option the method name; REST routes join the controller
 * prefix with the method decorator's path.
 */

/** Index just past the parenthesised argument list starting at `open` (which must be "("). */
function closeParen(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return src.length;
}

/** Name of the method a decorator ending at `from` applies to, skipping further decorators. */
function decoratedMethod(src: string, from: number): string | null {
  let i = from;
  for (;;) {
    const rest = src.slice(i);
    const deco = /^\s*@\w+(\.\w+)*/.exec(rest);
    if (!deco) break;
    i += deco[0].length;
    const after = /^\s*\(/.exec(src.slice(i));
    if (after) i = closeParen(src, i + after[0].length - 1);
  }
  const m = /^\s*(?:(?:public|private|protected|async|static)\s+)*(\w+)\s*[(<]/.exec(src.slice(i));
  return m ? m[1] : null;
}

function firstString(args: string): string | null {
  const m = /^\(\s*(['"`])([^'"`]*)\1/.exec(args);
  return m ? m[2] : null;
}

export function graphqlOperations(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/@(Query|Mutation|Subscription)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = closeParen(src, open);
    const args = src.slice(open, end);
    const named = /\bname\s*:\s*(['"`])(\w+)\1/.exec(args);
    const name = named ? named[2] : decoratedMethod(src, end);
    if (name) names.push(name);
  }
  return names;
}

export function restRoutes(src: string): string[] {
  const ctrl = /@Controller\s*\(/.exec(src);
  let prefix = '';
  if (ctrl) {
    const open = ctrl.index + ctrl[0].length - 1;
    const args = src.slice(open, closeParen(src, open));
    prefix = firstString(args) ?? /\bpath\s*:\s*(['"`])([^'"`]*)\1/.exec(args)?.[2] ?? '';
  }
  const routes: string[] = [];
  for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete|All)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const sub = firstString(src.slice(open, closeParen(src, open))) ?? '';
    const route = ['', prefix, sub].map(s => s.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
    routes.push('/' + route);
  }
  return routes;
}
