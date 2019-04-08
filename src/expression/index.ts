import { Parser } from 'acorn';
import endorphinParser from './acorn-plugin';
import { Program, Identifier, Expression } from '../ast';
import Scanner from '../scanner';
import { ancestor as walk } from '../walk';
import { eatPair } from '../utils';

export const jsGlobals = new Set(['Math', 'String', 'Boolean', 'Object']);

// @ts-ignore
const JSParser = Parser.extend(endorphinParser);

interface OffsetInfo {
    pos: number;
    line: number;
    column: number;
}

interface ParserOptions {
    offset?: OffsetInfo;
    url?: string;
    helpers?: string[];
}

export const EXPRESSION_START = 123; // {
export const EXPRESSION_END = 125; // }

/**
 * Consumes expression from current stream location
 */
export default function expression(scanner: Scanner): Program {
    if (eatPair(scanner, EXPRESSION_START, EXPRESSION_END)) {
        scanner.start++;
        const begin = scanner.start;
        const end = scanner.pos - 1;

        return parseJS(scanner.substring(begin, end), scanner);
    }
}

/**
 * Parses given JS code into AST and prepares it for Endorphin expression evaluation
 * @param code Code to parse
 * @param scanner Code location inside parsed template
 * @param sourceFile Source file URL from which expression is parsed
 */
export function parseJS(code: string, options: ParserOptions = {}): Program {
    const ast = JSParser.parse(code, {
        sourceType: 'module',
        sourceFile: options.url,
        locations: true,
        onToken(tok) {
            if (options.offset) {
                tok.start += options.offset.pos;
                tok.end += options.offset.pos;
                if (tok.loc) {
                    offsetPos(tok.loc.start, options.offset);
                    offsetPos(tok.loc.end, options.offset);
                }
            }
        }
    }) as Program;

    // Walk over AST and validate & upgrade nodes
    walk(ast, {
        Identifier(node: Identifier, state, ancestors) {
            if (jsGlobals.has(node.name) || isReserved(node, ancestors)) {
                return;
            }

            switch (node.name[0]) {
                case '#':
                    node.context = 'state';
                    node.name = node.name.slice(1);
                    break;
                case '@':
                    node.context = 'variable';
                    node.name = node.name.slice(1);
                    break;
                case '$':
                    node.context = 'store';
                    node.name = node.name.slice(1);
                    break;
                default:
                    node.context = options.helpers && options.helpers.includes(node.name)
                        ? 'helper' : 'property';
            }
        }
    });

    return ast;
}

/**
 * Check if given identifier is reserved by outer scope
 */
function isReserved(id: Identifier, ancestors: Expression[]): boolean {
    const last = ancestors[ancestors.length - 1];

    if (!last) {
        return false;
    }

    if (isFunctionArgument(id, last) || isProperty(id, last) || isAssignment(id, last)) {
        return true;
    }

    // Check if given identifier is defined as function argument
    for (let i = 0; i < ancestors.length; i++) {
        const ancestor = ancestors[i];
        if (ancestor.type === 'FunctionDeclaration' || ancestor.type === 'ArrowFunctionExpression') {
            const hasArg = ancestor.params.some(param => param.type === 'Identifier' && param.name === id.name);
            if (hasArg) {
                return true;
            }
        }
    }
}

function offsetPos(pos: acorn.Position, offset: OffsetInfo) {
    if (pos.line === 1) {
        pos.column += offset.column;
    }
    pos.line += offset.line;
}

/**
 * Check if given identifier is a function argument
 */
function isFunctionArgument(id: Identifier, expr: Expression): boolean {
    return (expr.type === 'FunctionDeclaration' || expr.type === 'ArrowFunctionExpression')
        && expr.params.includes(id);
}

/**
 * Check if given identifier is an object property
 */
function isProperty(id: Identifier, expr: Expression): boolean {
    return expr.type === 'MemberExpression' && expr.property === id;
}

/**
 * Check if given identifier is a left part of assignment expression
 */
function isAssignment(id: Identifier, expr: Expression): boolean {
    return 'left' in expr && expr.left === id;
}
