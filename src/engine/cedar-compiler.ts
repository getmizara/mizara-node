import jsep from 'jsep';

// Compiles a Mizara condition string into a Cedar boolean expression.
// Returns null for anything Cedar can't express (division, computed
// member access, unsupported operators) rather than a partial or
// incorrect translation.

const ROOT_IDENTIFIER_MAP: Record<string, string> = {
  actor: 'principal',
};

class UnsupportedConditionError extends Error {}

function translateNode(node: jsep.Expression): string {
  switch (node.type) {
    case 'Literal': {
      const value = (node as jsep.Literal).value;
      if (typeof value === 'string') return JSON.stringify(value); // Cedar requires double quotes
      if (typeof value === 'boolean') return String(value);
      if (typeof value === 'number') {
        // Cedar's numeric type is integer-only - no bare decimal literal
        // syntax. A whole number (jsep collapses "100.00" to 100)
        // converts cleanly; a genuinely fractional one has no safe
        // translation, so it's unsupported.
        if (!Number.isInteger(value)) throw new UnsupportedConditionError('Cedar has no bare decimal literal syntax');
        return String(value);
      }
      throw new UnsupportedConditionError(`Unsupported literal type: ${typeof value}`);
    }

    case 'Identifier': {
      const name = (node as jsep.Identifier).name;
      return ROOT_IDENTIFIER_MAP[name] ?? name;
    }

    case 'MemberExpression': {
      const member = node as jsep.MemberExpression;
      if (member.computed) throw new UnsupportedConditionError('Computed member access is not supported');
      const objectText = translateNode(member.object);
      const key = (member.property as jsep.Identifier).name;
      return `${objectText}.${key}`;
    }

    case 'BinaryExpression': {
      const bin = node as jsep.BinaryExpression;
      if (bin.operator === '/') throw new UnsupportedConditionError('Cedar does not support division');
      return `(${translateNode(bin.left)} ${bin.operator} ${translateNode(bin.right)})`;
    }

    case 'UnaryExpression': {
      const unary = node as jsep.UnaryExpression;
      if (unary.operator !== '!' && unary.operator !== '-') {
        throw new UnsupportedConditionError(`Unsupported unary operator: ${unary.operator}`);
      }
      return `${unary.operator}(${translateNode(unary.argument)})`;
    }

    case 'CallExpression': {
      const call = node as jsep.CallExpression;
      if (call.callee.type !== 'MemberExpression') {
        throw new UnsupportedConditionError('Only method-style calls are supported');
      }
      const callee = call.callee as jsep.MemberExpression;
      const methodName = (callee.property as jsep.Identifier).name;
      if (methodName !== 'contains') throw new UnsupportedConditionError(`Unsupported method: ${methodName}`);
      return `${translateNode(callee.object)}.contains(${translateNode(call.arguments[0])})`;
    }

    default:
      throw new UnsupportedConditionError(`Unsupported expression type: ${node.type}`);
  }
}

// Every distinct member-access path in the condition (e.g.
// "resource.attributes.amount"), so each can be `has`-guarded before
// use - Cedar throws on a missing attribute, where the jsep evaluator
// returns `undefined` (false in a comparison).
function collectMemberPaths(node: jsep.Expression, paths: Set<string>): void {
  switch (node.type) {
    case 'MemberExpression': {
      const member = node as jsep.MemberExpression;
      if (!member.computed) {
        paths.add(translateNode(node));
        collectMemberPaths(member.object, paths);
      }
      return;
    }
    case 'BinaryExpression': {
      const bin = node as jsep.BinaryExpression;
      collectMemberPaths(bin.left, paths);
      collectMemberPaths(bin.right, paths);
      return;
    }
    case 'UnaryExpression':
      collectMemberPaths((node as jsep.UnaryExpression).argument, paths);
      return;
    case 'CallExpression': {
      const call = node as jsep.CallExpression;
      if (call.callee.type === 'MemberExpression') {
        collectMemberPaths((call.callee as jsep.MemberExpression).object, paths);
      }
      for (const arg of call.arguments) collectMemberPaths(arg, paths);
      return;
    }
    default:
      return; // Literal, Identifier: nothing to guard
  }
}

// "resource.attributes.amount" -> "resource has attributes &&
// resource.attributes has amount" - has only checks one level, so a
// multi-level path needs one guard per level, not just the leaf.
function hasGuardFor(path: string): string {
  const parts = path.split('.');
  const guards: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    guards.push(`${parts.slice(0, i).join('.')} has ${parts[i]}`);
  }
  return guards.join(' && ');
}

export function compileConditionToCedar(condition: string): string | null {
  let ast: jsep.Expression;
  try {
    ast = jsep(condition);
  } catch {
    return null;
  }

  try {
    const translated = translateNode(ast);
    const paths = new Set<string>();
    collectMemberPaths(ast, paths);
    const guards = [...paths].map(hasGuardFor).filter(Boolean);
    return guards.length === 0 ? translated : `(${guards.join(' && ')}) && ${translated}`;
  } catch (err) {
    if (err instanceof UnsupportedConditionError) return null;
    throw err;
  }
}
