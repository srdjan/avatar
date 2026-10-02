import ts from "npm:typescript@5.9.3";

type FunctionMetric = Readonly<{ name: string; complexity: number }>;
type RuntimeMetrics = Readonly<{
  branches: number;
  functions: number;
  maxComplexity: FunctionMetric;
}>;

const assetPath = "assets/private/facial-rig.js";
const gitRefArgument = Deno.args.find((argument) => argument.startsWith("--git-ref="));
const gitRef = gitRefArgument?.slice("--git-ref=".length);
const check = Deno.args.includes("--check");
const source = gitRef === undefined
  ? await Deno.readTextFile(new URL(`../${assetPath}`, import.meta.url))
  : await readGitFile(gitRef, assetPath);
const metrics = measureRuntime(source);
console.log(JSON.stringify({ source: gitRef ?? "working-tree", ...metrics }));
if (check && metrics.branches > 406) {
  throw new Error(`runtime branch budget exceeded: ${metrics.branches} > 406`);
}
if (check && metrics.maxComplexity.complexity > 14) {
  throw new Error(
    `runtime complexity budget exceeded: ${metrics.maxComplexity.name} ` +
      `${metrics.maxComplexity.complexity} > 14`,
  );
}

async function readGitFile(ref: string, path: string): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["show", `${ref}:${path}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout);
}

function measureRuntime(source: string): RuntimeMetrics {
  const file = ts.createSourceFile(
    assetPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let branches = 0;
  const functions: FunctionMetric[] = [];
  const visit = (node: ts.Node): void => {
    branches += branchWeight(node);
    if (isMeasuredFunction(node)) functions.push(measureFunction(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  const maxComplexity = functions.reduce<FunctionMetric>(
    (highest, current) => current.complexity > highest.complexity ? current : highest,
    { name: "<none>", complexity: 0 },
  );
  return { branches, functions: functions.length, maxComplexity };
}

function branchWeight(node: ts.Node): number {
  if (ts.isIfStatement(node)) return 1 + (node.elseStatement === undefined ? 0 : 1);
  if (
    ts.isConditionalExpression(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)
  ) return 1;
  if (
    ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isCatchClause(node)
  ) return 1;
  if (ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)) return 1;
  if (isOptionalChain(node)) return 1;
  if (ts.isReturnStatement(node) && hasBranchAncestor(node)) return 1;
  return 0;
}

function measureFunction(node: ts.FunctionLikeDeclaration): FunctionMetric {
  let complexity = 1;
  const visit = (child: ts.Node): void => {
    if (child !== node && isMeasuredFunction(child)) return;
    complexity += complexityWeight(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return { name: functionName(node), complexity };
}

function complexityWeight(node: ts.Node): number {
  if (
    ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node) ||
    ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isCatchClause(node)
  ) return 1;
  return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind) ? 1 : 0;
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken;
}

function isOptionalChain(node: ts.Node): boolean {
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)) &&
    node.questionDotToken !== undefined;
}

function hasBranchAncestor(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isFunctionLike(current)) return false;
    if (
      ts.isIfStatement(current) || ts.isConditionalExpression(current) ||
      ts.isCaseClause(current) || ts.isForStatement(current) ||
      ts.isForInStatement(current) || ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) || ts.isDoStatement(current) || ts.isCatchClause(current)
    ) return true;
  }
  return false;
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText();
  return "<anonymous>";
}

function isMeasuredFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node);
}
