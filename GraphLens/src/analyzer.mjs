import { buildSchema, parse, validate, getOperationAST, getNamedType, isObjectType, isInterfaceType, isUnionType, valueFromASTUntyped, getVariableValues } from 'graphql';

export function inventory(schema) {
  const types = new Map();
  function walk(type) {
    type = getNamedType(type);
    if (!type || type.name.startsWith('__') || types.has(type.name)) return;
    if (isUnionType(type)) { types.set(type.name, { name: type.name, kind: 'union', fields: [] }); type.getTypes().forEach(walk); return; }
    if (!isObjectType(type) && !isInterfaceType(type)) return;
    const fields = Object.values(type.getFields()).map(field => ({ key: `${type.name}.${field.name}`, name: field.name, type: String(field.type), target: getNamedType(field.type).name, description: field.description || '', args: field.args.map(arg => ({ name: arg.name, type: String(arg.type) })) }));
    types.set(type.name, { name: type.name, kind: isInterfaceType(type) ? 'interface' : 'object', fields });
    Object.values(type.getFields()).forEach(field => walk(field.type));
    if (isInterfaceType(type)) schema.getPossibleTypes(type).forEach(walk);
  }
  [schema.getQueryType(), schema.getMutationType()].filter(Boolean).forEach(walk);
  return [...types.values()];
}

export function analyze(sdl, payload) {
  try {
    const schema = buildSchema(sdl);
    const document = parse(payload.query);
    const errors = validate(schema, document);
    if (errors.length) return { error: errors.map(e => e.message).join('\n') };
    const operation = getOperationAST(document, payload.operationName);
    if (!operation) return { error: 'Укажите operationName для документа с несколькими операциями.' };
    if (operation.operation === 'subscription') return { error: 'Подписки находятся за пределами MVP.' };
    const values = getVariableValues(schema, operation.variableDefinitions || [], payload.variables || {});
    if (values.errors) return { error: values.errors.map(e => e.message).join('\n') };
    const variables = values.coerced;
    const fragments = new Map(document.definitions.filter(d => d.kind === 'FragmentDefinition').map(d => [d.name.value, d]));
    const fields = new Set(), types = new Set(), argumentsUsed = new Set(), paths = new Set();
    let depth = 0;
    function included(node) {
      for (const directive of node.directives || []) {
        if (!['skip', 'include'].includes(directive.name.value)) continue;
        const arg = directive.arguments.find(a => a.name.value === 'if');
        const value = valueFromASTUntyped(arg.value, variables);
        if (directive.name.value === 'skip' ? value : !value) return false;
      }
      return true;
    }
    function walk(selectionSet, parent, path = [], active = new Set()) {
      for (const node of selectionSet.selections) {
        if (!included(node)) continue;
        if (node.kind === 'FragmentSpread') {
          if (active.has(node.name.value)) continue;
          const fragment = fragments.get(node.name.value);
          walk(fragment.selectionSet, schema.getType(fragment.typeCondition.name.value), path, new Set([...active, node.name.value]));
        } else if (node.kind === 'InlineFragment') {
          walk(node.selectionSet, node.typeCondition ? schema.getType(node.typeCondition.name.value) : parent, path, active);
        } else if (!node.name.value.startsWith('__')) {
          const field = parent.getFields()[node.name.value];
          const key = `${parent.name}.${field.name}`;
          fields.add(key); types.add(parent.name);
          const nextPath = [...path, key]; paths.add(nextPath.join(' → ')); depth = Math.max(depth, nextPath.length);
          for (const arg of node.arguments || []) argumentsUsed.add(`${key}(${arg.name.value})`);
          if (node.selectionSet) walk(node.selectionSet, getNamedType(field.type), nextPath, active);
        }
      }
    }
    walk(operation.selectionSet, operation.operation === 'mutation' ? schema.getMutationType() : schema.getQueryType());
    return { operation: operation.operation, name: operation.name?.value || 'Anonymous', fields: [...fields], types: [...types], arguments: [...argumentsUsed], paths: [...paths], depth };
  } catch (error) { return { error: error.message }; }
}

export function coverage(sdl, executions) {
  const types = inventory(buildSchema(sdl));
  const counts = new Map();
  const tests = new Map();
  for (const execution of executions) {
    const analysis = typeof execution.analysis === 'string' ? JSON.parse(execution.analysis) : execution.analysis;
    for (const field of analysis.fields || []) {
      counts.set(field, (counts.get(field) || 0) + 1);
      if (!tests.has(field)) tests.set(field, new Set());
      if (execution.test_name) tests.get(field).add(execution.test_name);
    }
  }
  for (const type of types) {
    type.fields = type.fields.map(field => ({ ...field, hits: counts.get(field.key) || 0, tests: [...(tests.get(field.key) || [])] }));
    type.hits = executions.filter(execution => {
      const analysis = typeof execution.analysis === 'string' ? JSON.parse(execution.analysis) : execution.analysis;
      return analysis.types?.includes(type.name);
    }).length;
    type.covered = type.fields.filter(f => f.hits).length;
    type.total = type.fields.length;
    type.percent = type.total ? Math.round(type.covered / type.total * 100) : 0;
  }
  const fields = types.flatMap(type => type.fields);
  const covered = fields.filter(f => f.hits).length;
  return { types, total: fields.length, covered, percent: fields.length ? Math.round(covered / fields.length * 100) : 0, coveredTypes: types.filter(t => t.covered).length, totalTypes: types.filter(t => t.total).length, requests: executions.length };
}
