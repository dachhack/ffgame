// THE RULES OF HOOKS (v0.702.0). Founder: "let's add the rules-of-hooks check."
//
// v0.700.0 declared a screen's hooks after its early returns; the phone opened
// My Team to "Rendered more hooks than during the previous render" for a day
// (v0.701.5), and nothing in the battery could have caught it: the repo has
// no ESLint. This is the one rule, on the TypeScript compiler the repo already
// ships, with no new dependency:
//
//   In a component (a function named LikeThis) or a hook (named useLikeThis),
//   every hook call sits at the top level of the body — not inside an if, a
//   loop, a switch, a try, a ?: or a && / || / ??, not inside a nested
//   function or callback, and not after a statement that can return.
//
// A function named neither way that calls a hook is reported too: React would
// not treat it as a component, so its hooks run in whatever called it.
//
//   npm run check:hooks            every .ts/.tsx under src, apps/mobile/src, packages/core/src
//   tsx scripts/check-hooks.mjs <file …>   just these
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'apps/mobile/src', 'packages/core/src'];
const HOOK = /^use[A-Z0-9]/;
const COMPONENT = /^[A-Z]/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(name) && !/\.d\.ts$/.test(name)) yield p;
  }
}

const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
/** The name a function goes by: its own, the variable it is assigned to, or the one around a forwardRef/memo wrapper. */
function nameOf(fn) {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  let p = fn.parent;
  // const X = (…) => …   |   const X = forwardRef((…) => …)   |   const X = memo(function (…) {…})
  for (let i = 0; i < 3 && p; i++) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isCallExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p)) { p = p.parent; continue; }
    break;
  }
  return null;
}
const hookCallName = (call) => {
  const c = call.expression;
  if (ts.isIdentifier(c) && HOOK.test(c.text)) return c.text;
  if (ts.isPropertyAccessExpression(c) && HOOK.test(c.name.text)) return c.name.text;
  return null;
};
/** Can this statement return out of the function (not counting nested functions)? */
function mayReturn(node) {
  if (ts.isReturnStatement(node)) return true;
  if (isFn(node)) return false;
  let hit = false;
  node.forEachChild((c) => { if (!hit && mayReturn(c)) hit = true; });
  return hit;
}
const CONDITIONAL = (n) => ts.isIfStatement(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n)
  || ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isSwitchStatement(n) || ts.isTryStatement(n) || ts.isConditionalExpression(n)
  || (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind));

function check(file, text, report) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  /** Hook calls under `node`, each with whether the path from `node` passed a conditional; nested functions are
   *  NOT entered (they are scopes of their own, below). */
  // Only the SKIPPABLE part of a conditional is conditional: the right of && / || / ??, the branches of a ?:, the
  // body of an if (not its test) — `return useContext(X) ?? {}` evaluates the hook every render.
  const skippable = (parent, c) => (ts.isBinaryExpression(parent) ? c === parent.right
    : ts.isConditionalExpression(parent) ? c !== parent.condition
    : (ts.isIfStatement(parent) || ts.isSwitchStatement(parent)) ? c !== parent.expression
    : true);
  const hooksUnder = (node, out, cond = false) => {
    node.forEachChild((c) => {
      if (isFn(c)) return;
      const cc = cond || (CONDITIONAL(node) && skippable(node, c));   // the child's own standing, not its parent's
      if (ts.isCallExpression(c)) { const h = hookCallName(c); if (h) out.push({ call: c, name: h, cond: cc }); }
      hooksUnder(c, out, cc);
    });
    return out;
  };
  const scopes = [];   // every function in the file
  const collect = (n) => { if (isFn(n)) scopes.push(n); n.forEachChild(collect); };
  collect(sf);
  for (const fn of scopes) {
    const name = nameOf(fn);
    const owner = name != null && (COMPONENT.test(name) || HOOK.test(name));
    const body = fn.body;
    if (!body) continue;
    if (!ts.isBlock(body)) {
      // a concise arrow: its hooks must not sit under a conditional
      for (const h of hooksUnder(body, [])) {
        if (!owner) report(file, line(h.call), `${h.name} in ${name ?? 'an anonymous function'}, which is neither a component nor a hook`);
        else if (h.cond) report(file, line(h.call), `${h.name} under a condition in ${name}`);
      }
      continue;
    }
    let returned = null;   // the first statement that may return
    for (const st of body.statements) {
      const hooks = hooksUnder(st, []);
      for (const h of hooks) {
        if (!owner) { report(file, line(h.call), `${h.name} in ${name ?? 'an anonymous function'}, which is neither a component nor a hook (hooks run in whoever calls it)`); continue; }
        if (returned) { report(file, line(h.call), `${h.name} in ${name} after a return on line ${returned} — the hook count changes between renders`); continue; }
        if (h.cond || !(ts.isVariableStatement(st) || ts.isExpressionStatement(st) || ts.isReturnStatement(st))) report(file, line(h.call), `${h.name} under a condition in ${name}`);
      }
      if (!returned && mayReturn(st)) returned = line(st);
    }
  }
}

// --selftest: the checker against the shapes it exists for — v0.700.0's hook after a return, a hook in an if, in
// a callback, in a plain function — and the legal ones it must let through.
if (process.argv.includes('--selftest')) {
  const run = (src) => { const out = []; check('t.tsx', src, (_f, ln, msg) => out.push(`${ln}: ${msg}`)); return out; };
  const bad = run(`
function Screen({ st }: { st: unknown }) {
  const [a] = useState(0);
  if (a) { const c = useRef(0); }
  const d = a && useMemo(() => 1, []);
  const e = useCallback(() => { const f = useState(2); }, []);
  if (!st) return null;
  const [b] = useState(1);
  return <div>{b}{d}{e}</div>;
}
function helper() { return useContext(X); }
`);
  const good = run(`
function useThing(): number { return useContext(X) ?? 0; }
export function Shell({ st }: { st: unknown }) {
  const t = useTheme();
  const v = useMemo(() => t.x ? 1 : 2, [t]);
  useEffect(() => { if (v) doThing(); }, [v]);
  const Row = ({ i }: { i: number }) => { const z = useRef(i); return <span>{z.current}</span>; };
  if (!st) return null;
  return <Row i={v} />;
}
`);
  const want = ['4: useRef under a condition', '5: useMemo under a condition', '6: useState in e', '8: useState in Screen after a return on line 7', '11: useContext in helper'];
  const miss = want.filter((w) => !bad.some((b) => b.startsWith(w) || b.includes(w)));
  if (miss.length || good.length) { console.log('FAIL  selftest', { missed: miss, falseAlarms: good, got: bad }); process.exit(1); }
  console.log('ok    selftest — the rule catches a hook after a return, under a condition, in a callback, in a plain function; the legal shapes pass');
  process.exit(0);
}
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = args.length ? args : ROOTS.flatMap((r) => { try { return [...walk(r)]; } catch { return []; } });
const found = [];
for (const f of files) check(f, readFileSync(f, 'utf8'), (file, ln, msg) => found.push(`${relative(process.cwd(), file)}:${ln}: ${msg}`));
for (const f of found) console.log(`FAIL  ${f}`);
console.log(found.length ? `${found.length} RULES-OF-HOOKS FINDING(S) in ${files.length} files` : `ok    rules of hooks hold in ${files.length} files`);
process.exit(found.length ? 1 : 0);
