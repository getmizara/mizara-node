import jsep from 'jsep';
import type { AuthorizeInput } from '../types';

// Policy conditions are parsed with jsep (AST only, no eval/Function) and
// evaluated against a restricted, read-only scope.

type Scope = Record<string, unknown>;

export function evaluateCondition(condition: string, input: AuthorizeInput): boolean {
  const ast = jsep(condition);
  const scope: Scope = {
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    context: input.context ?? {},
  };
  return Boolean(evaluateNode(ast, scope));
}

function evaluateNode(node: jsep.Expression, scope: Scope): unknown {
  switch (node.type) {
    case 'Literal':
      return (node as jsep.Literal).value;

    case 'Identifier':
      return scope[(node as jsep.Identifier).name];

    case 'MemberExpression': {
      const member = node as jsep.MemberExpression;
      const obj = evaluateNode(member.object, scope) as Scope | undefined;
      if (obj === undefined || obj === null) return undefined;
      const key = member.computed
        ? (evaluateNode(member.property, scope) as string)
        : (member.property as jsep.Identifier).name;
      return obj[key];
    }

    case 'BinaryExpression': {
      const bin = node as jsep.BinaryExpression;
      // && and || are parsed by jsep as BinaryExpression nodes (jsep has no
      // separate LogicalExpression type), so short-circuit them here.
      if (bin.operator === '&&') return evaluateNode(bin.left, scope) && evaluateNode(bin.right, scope);
      if (bin.operator === '||') return evaluateNode(bin.left, scope) || evaluateNode(bin.right, scope);

      const left = evaluateNode(bin.left, scope);
      const right = evaluateNode(bin.right, scope);
      return applyBinaryOperator(bin.operator, left, right);
    }

    case 'UnaryExpression': {
      const unary = node as jsep.UnaryExpression;
      const arg = evaluateNode(unary.argument, scope);
      if (unary.operator === '!') return !arg;
      if (unary.operator === '-') return -(arg as number);
      throw new Error(`Unsupported unary operator: ${unary.operator}`);
    }

    case 'CallExpression': {
      const call = node as jsep.CallExpression;
      if (call.callee.type !== 'MemberExpression') {
        throw new Error('Only method-style calls (e.g. array.contains(x)) are supported in policy conditions');
      }
      const callee = call.callee as jsep.MemberExpression;
      const methodName = (callee.property as jsep.Identifier).name;

      if (methodName === 'contains') {
        const target = evaluateNode(callee.object, scope);
        const arg = evaluateNode(call.arguments[0], scope);
        if (Array.isArray(target)) return target.includes(arg);
        if (typeof target === 'string') return target.includes(String(arg));
        return false;
      }

      throw new Error(`Unsupported function in policy condition: ${methodName}`);
    }

    default:
      throw new Error(`Unsupported expression in policy condition: ${node.type}`);
  }
}

function applyBinaryOperator(operator: string, left: unknown, right: unknown): unknown {
  switch (operator) {
    case '==':  return left === right;
    case '!=':  return left !== right;
    case '<=':  return (left as number) <= (right as number);
    case '>=':  return (left as number) >= (right as number);
    case '<':   return (left as number) <  (right as number);
    case '>':   return (left as number) >  (right as number);
    case '+':   return (left as number) +  (right as number);
    case '-':   return (left as number) -  (right as number);
    case '*':   return (left as number) *  (right as number);
    case '/':   return (left as number) /  (right as number);
    default:
      throw new Error(`Unsupported operator in policy condition: ${operator}`);
  }
}
