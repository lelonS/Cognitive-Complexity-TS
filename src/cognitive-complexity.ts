import * as ts from "typescript";
import { OutputElem, OutputFileElem } from "./types";
import { throwingIterator } from "./util";

type ForLikeStatement = ts.ForStatement | ts.ForInOrOfStatement;

class UnexpectedNodeError extends Error {
    constructor(public readonly node: ts.Node) {
        super("Unexpected Node");
    }
}

function calcElemCost(node: ts.Node, depth = 0): OutputElem {
    const inner = [] as OutputElem[];

    let score = 0;
    for (const child of node.getChildren()) {
        const elem = calcElemCost(child);
        score += elem.score;
        inner.push(elem);
    }

    const { line, character: column } = node.getSourceFile()
        .getLineAndCharacterOfPosition(node.getStart());

    const nodeCost = new NodeCost(node, depth);
    score += nodeCost.score;
    inner.push(...nodeCost.inner);

    return {
        name: node.getFullText(), // TODO make this match the function etc
        score,
        line,
        column,
        inner,
    };
}

export function calcFileCost(file: ts.SourceFile): OutputFileElem {
    return new FileCost(file);
}

abstract class AbstractNodeCost<N extends ts.Node> {
    protected _score = 0;
    public readonly inner = [] as OutputElem[];

    constructor(
        protected node: N,
        protected depth: number
    ) {
        this.calculate();
    }

    // can probs put depth in the constructor as readonly
    // maybe make this get called in the constructor
    protected abstract calculate(): void;

    protected include(node: ts.Node, depth: number) {
        const elem = calcElemCost(node, depth);
        this.inner.push(elem);
        this._score += elem.score;
    }

    protected includeAll(nodes: ts.Node[], depth: number) {
        for (const child of nodes) {
            this.include(child, depth);
        }
    }

    get score(): number {
        return this._score;
    }
}

class NodeCost extends AbstractNodeCost<ts.Node> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        // certain langauge features carry and inherent cost
        if (ts.isCatchClause(node)
            || ts.isConditionalExpression(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isForStatement(node)
            || ts.isIfStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isWhileStatement(node)
            || isBreakOrContinueToLabel(node)
        ) {
            this._score += 1;
        }

        // increment for nesting level
        if (depth > 0 && (
            ts.isConditionalExpression(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isForStatement(node)
            || ts.isIfStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isWhileStatement(node)
        )) {
            this._score += depth;
        }

        // TODO write isSequenceOfBinaryOperators to check whether to do an inherent increment
        // BinaryExpressions have 1 child that is the operator
        // BinaryExpressions have their last child as a sub expression
        // can just consume the entire sequence of the same operator
        // then continue traversing from the next different operator in the sequence,
        // which presumably will be given another inherent increment by the next call to calcNodeCost
        // should redundant brackets be ignored? or do they end a sequence?
        // probably the latter, which would also be easier

        // certain structures increment depth for their child nodes
        if (ts.isArrowFunction(node)) {
            const { inner, score } = new ArrowFunctionCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isCatchClause(node)) {
            this.includeAll(node.getChildren(), depth + 1);
        } else if (ts.isConditionalExpression(node)) {
            const { inner, score } = new ConditionalExpressionCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isDoStatement(node)) {
            const { inner, score } = new DoStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (isForLikeStatement(node)) {
            const { inner, score } = new ForLikeStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isFunctionDeclaration(node)) {
            const { inner, score } = new FunctionDeclarationCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isFunctionExpression(node)) {
            const { inner, score } = new FunctionExpressionCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isIfStatement(node)) {
            const { inner, score } = new IfStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isMethodDeclaration(node)) {
            const { inner, score } = new MethodDeclarationCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isSwitchStatement(node)) {
            const { inner, score } = new SwitchStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else if (ts.isWhileStatement(node)) {
            const { inner, score } = new WhileStatementCost(node, depth);
            this.inner.push(...inner);
            this._score += score;
        } else {
            this.includeAll(node.getChildren(), depth);
        }
    }
}

abstract class AbstractFunctionCost<N extends ts.Node> extends AbstractNodeCost<N> {
    constructor(
        node: N,
        depth: number,
        protected topLevel: boolean = isTopLevel(node),
    ) {
        super(node, depth);
    }
}

class ArrowFunctionCost extends AbstractFunctionCost<ts.ArrowFunction> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        // consume OpenParenToken
        nextChild();
        // aggregate code inside SyntaxList
        this.include(nextChild(), depth);
        // consume CloseParenToken
        nextChild();
        // consume EqualsGreaterThanToken
        nextChild();
        // aggregate code inside arrow function
        this.include(nextChild(), this.topLevel ? depth : depth + 1);
    }
}

class ConditionalExpressionCost extends AbstractNodeCost<ts.ConditionalExpression> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        let childNodesToAggregate = [] as ts.Node[];

        for (const child of node.getChildren()) {
            if (ts.isToken(child) && child.kind === ts.SyntaxKind.QuestionToken) {
                // aggregate condition
                this.includeAll(childNodesToAggregate, depth);
                childNodesToAggregate = [];

            } else if (ts.isToken(child) && child.kind === ts.SyntaxKind.ColonToken) {
                // aggregate then
                this.includeAll(childNodesToAggregate, depth + 1);
                childNodesToAggregate = [];

            } else {
                childNodesToAggregate.push();
            }
        }

        // aggregate else
        this.includeAll(childNodesToAggregate, depth);
    }
}

class DoStatementCost extends AbstractNodeCost<ts.DoStatement> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        // consume do token
        nextChild();
        // aggregate block
        this.include(nextChild(), depth + 1);
        // consume while keyword
        nextChild();
        // consume open paren
        nextChild();
        // aggregate condition
        this.include(nextChild(), depth);
    }
}

class IfStatementCost extends AbstractNodeCost<ts.IfStatement> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        while (true) {
            const child = nextChild();
            if (ts.isToken(child) && child.kind === ts.SyntaxKind.IfKeyword) {
                // consume open parenthesis
                nextChild();
                // aggregate condition
                this.include(nextChild(), depth);
            } else if (ts.isToken(child) && child.kind === ts.SyntaxKind.CloseParenToken) {
                // aggregate then
                this.include(nextChild(), depth + 1);
            } else if (ts.isToken(child) && child.kind === ts.SyntaxKind.ElseKeyword) {
                // aggregate else
                this.include(nextChild(), depth + 1);
                break;
            } else {
                throw new UnexpectedNodeError(child);
            }
        }
    }
}

class FileCost extends AbstractNodeCost<ts.SourceFile> {
    constructor(file: ts.SourceFile) {
        super(file, 0);
    }

    protected calculate() {
        this.includeAll(this.node.getChildren(), this.depth);
    }
}

class ForLikeStatementCost extends AbstractNodeCost<ForLikeStatement> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        // consume for keyword
        nextChild();
        // consume open parenthesis
        nextChild();

        // consume everything up to the close parenthesis
        while (true) {
            const child = nextChild();
            if (ts.isToken(child) && child.kind === ts.SyntaxKind.CloseParenToken) {
                break;
            }

            this.include(child, depth);
        }

        // consume looped code
        this.include(nextChild(), depth + 1);
    }
}

class FunctionDeclarationCost extends AbstractFunctionCost<ts.FunctionDeclaration> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        while (true) {
            const child = nextChild();

            if (isSyntaxList(child)) {
                this.include(child, depth);
            } else if (ts.isBlock(child)) {
                this.include(child, depth + 1);
                break;
            }
        }
    }
}

class FunctionExpressionCost extends AbstractFunctionCost<ts.FunctionExpression> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const children = node.getChildren();
        const functionBody = children.slice(-1);
        const functionDecl = children.slice(0, -1)[0];

        this.includeAll(functionBody, depth);
        this.include(functionDecl, depth + 1);
    }
}

class MethodDeclarationCost extends AbstractFunctionCost<ts.MethodDeclaration> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        while (true) {
            const child = nextChild();
            if (ts.isBlock(child)) {
                this.include(nextChild(), this.topLevel ? depth : depth + 1);
                break;
            }

            this.include(child, depth);
        }
    }
}


class SwitchStatementCost extends AbstractNodeCost<ts.SwitchStatement> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        // consume switch keyword
        nextChild();
        // consume open parenthesis
        nextChild();
        // aggregate condition
        this.include(nextChild(), depth);
        // consume close parenthesis
        nextChild();
        // consume cases
        this.include(nextChild(), depth + 1);
    }
}

class WhileStatementCost extends AbstractNodeCost<ts.WhileStatement> {
    protected calculate() {
        const depth = this.depth;
        const node = this.node;

        const nextChild = throwingIterator(node.getChildren().values());

        while (true) {
            const child = nextChild();
            if (ts.isToken(child) && child.kind === ts.SyntaxKind.WhileKeyword) {
                // consume open parenthesis
                nextChild();
                // aggregate condition
                this.include(nextChild(), depth);
            } if (ts.isToken(child) && child.kind === ts.SyntaxKind.CloseParenToken) {
                // aggregate loop code
                this.include(nextChild(), depth + 1);
                break;
            } else {
                throw new UnexpectedNodeError(child);
            }
        }
    }
}

function isBreakOrContinueToLabel(node: ts.Node): boolean {
    if (ts.isBreakOrContinueStatement(node)) {
        for (const child of node.getChildren()) {
            if (ts.isIdentifier(child)) {
                return true;
            }
        }
    }

    return false;
}

function isForLikeStatement(node: ts.Node): node is ForLikeStatement {
    return ts.isForInStatement(node)
        || ts.isForOfStatement(node)
        || ts.isForStatement(node);
}

function isSyntaxList(node: ts.Node): node is ts.SyntaxList {
    return node.kind === ts.SyntaxKind.SyntaxList;
}

function isTopLevel(node: ts.Node): boolean {
    const parent = node.parent;

    // TODO check what the parent of a ts.SourceFile is
    if (parent === undefined) {
        console.trace();
        return true;
    }

    if (ts.isSourceFile(parent)) {
        return true;
    }

    let highestNonBlockAncestor = parent;
    while (ts.isBlock(highestNonBlockAncestor)) {
        highestNonBlockAncestor = highestNonBlockAncestor.parent;
    }

    if (highestNonBlockAncestor === parent) {
        return false;
    }

    return isTopLevel(highestNonBlockAncestor);
}
