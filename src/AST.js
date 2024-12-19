import { AllImages, OutputSounds } from "./KhanResources";

var ASTBuilder = {
    /**
     * @param {Expression} left
     * @param {string} operator: "=", "+=", "-=", "*=", "/=", etc.
     * @param {Expression} right
     */
    AssignmentExpression: function AssignmentExpression(left, operator, right) {
        return {
            type: "AssignmentExpression",
            left: left,
            operator: operator,
            right: right
        };
    },
    /**
     * @param {Expression} left
     * @param {string} operator: "+", "-", "*", "/", "<", ">", "<=", ">=", etc.
     * @param {Expression} right
     */
    BinaryExpression: function BinaryExpression(left, operator, right) {
        return {
            type: "BinaryExpression",
            left: left,
            operator: operator,
            right: right
        };
    },
    /**
     * @param {Array} body: an array of Expressions
     */
    BlockStatement: function BlockStatement(body) {
        return {
            type: "BlockStatement",
            body: body
        };
    },
    /**
     * @param {Expression} callee
     * @param {Array} args
     */
    CallExpression: function CallExpression(callee, args) {
        return {
            type: "CallExpression",
            callee: callee,
            arguments: args
        };
    },
    /**
     * @param {Expression} expression
     */
    ExpressionStatement: function ExpressionStatement(expression) {
        return {
            type: "ExpressionStatement",
            expression: expression
        };
    },
    /**
     * @param {string} name
     */
    Identifier: function Identifier(name) {
        return {
            type: "Identifier",
            name: name
        };
    },
    /**
     * @param {Expression} test
     * @param {Statement} consequent: usually a BlockStatement
     * @param {Statement?} alternate: usually a BlockStatement when not omitted
     */
    IfStatement: function IfStatement(test, consequent) {
        var alternate = arguments.length <= 2 || arguments[2] === undefined ? null : arguments[2];

        return {
            type: "IfStatement",
            test: test,
            consequent: consequent,
            alternate: alternate
        };
    },
    /**
     * @param {Number|String|null|RegExp} value
     */
    Literal: function Literal(value) {
        return {
            type: "Literal",
            value: value
        };
    },
    /**
     * @param {Expression} object
     * @param {Expression} property
     * @param {Boolean?} computed - true => obj[prop], false => obj.prop
     */
    MemberExpression: function MemberExpression(object, property) {
        var computed = arguments.length <= 2 || arguments[2] === undefined ? false : arguments[2];

        return {
            type: "MemberExpression",
            object: object,
            property: property,
            computed: computed
        };
    },
    /**
     * @param {Expression} argument
     * @param {string} operator: "++" or "--"
     * @param {Boolean} prefix: true => ++argument, false => argument++
     */
    UpdateExpression: function UpdateExpression(argument, operator, prefix) {
        return {
            type: "UpdateExpression",
            argument: argument,
            operator: operator,
            prefix: prefix
        };
    },
    /**
     * @param {Array} declarations
     * @param {string} kind: "var", "let", "const"
     */
    VariableDeclaration: function VariableDeclaration(declarations, kind) {
        return {
            type: "VariableDeclaration",
            declarations: declarations,
            kind: kind
        };
    },
    ArrayPattern: function (elements) {
        return {
            type: "ArrayPattern",
            elements: elements
        }
    }
};

/**
 * Traverses an AST and calls visitor methods on each of the visitors.
 *
 * @param node: The root of the AST to walk.
 * @param path: An array containing all of the ancestors and the current node.
 *              Callers should pass in null.
 * @param visitors: One or more objects containing 'enter' and/or 'leave'
 *                  methods which accept a single AST node as an argument.
 */
var walkAST = function (node, path, visitors) {
    if (path === null) {
        path = [node];
    } else {
        path.push(node);
    }
    visitors.forEach(function (visitor) {
        if (visitor.enter) {
            visitor.enter(node, path);
        }
    });
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
        for (var _iterator = Object.keys(node)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var prop = _step.value;

            if (node.hasOwnProperty(prop) && node[prop] instanceof Object) {
                if (Array.isArray(node[prop])) {
                    var i = 0;
                    while (i < node[prop].length) {
                        // Esprima represents empty slots as null, so set child to
                        // a dummy node if the initial node is falsy in order to prevent
                        // a silent crash
                        var child = node[prop][i] || { type: "EmptySlot" };
                        // Skip over the number of replacements.  This is usually
                        // just 1, but in situations involving multiple variable
                        // declarations we end up replacing one statement with
                        // multiple statements and we need to step over all of them.
                        i += walkAST(child, path, visitors);
                    }
                } else if (node[prop].type) {
                    // don't walk metadata props like "loc"
                    walkAST(node[prop], path, visitors);
                }
            }
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally {
        try {
            if (!_iteratorNormalCompletion && _iterator["return"]) {
                _iterator["return"]();
            }
        } finally {
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }

    var step = 1;
    visitors.forEach(function (visitor) {
        if (visitor.leave) {
            (function () {
                var replacement = visitor.leave(node, path);
                if (replacement) {
                    if (replacement instanceof Array) {
                        var _parent = path[path.length - 2];
                        if (_parent.body) {
                            var index = _parent.body.findIndex(function (child) {
                                return child === node;
                            });
                            Array.prototype.splice.apply(_parent.body, [index, 1].concat(replacement));
                            // Since we replaced one statement with multiple statements
                            // we'll want to skip over all of them so set 'step' to
                            // the number of replacements.
                            step = replacement.length;
                        }
                    } else {
                        Object.keys(node).forEach(function (key) {
                            delete node[key];
                        });
                        Object.keys(replacement).forEach(function (key) {
                            node[key] = replacement[key];
                        });
                    }
                }
            })();
        }
    });
    path.pop();
    return step;
};

var ASTTransforms = {};

var b = ASTBuilder;

var isReference = function isReference(node, parent) {

    // we're a property key so we aren't referenced
    if (parent.type === "Property" && parent.key === node) {
        return false;
    }

    // we're a variable declarator id so we aren't referenced
    if (parent.type === "VariableDeclarator" && (parent.id === node || parent.id.type === "ArrayPattern")) {
        return false;
    }

    var isMemberExpression = parent.type === "MemberExpression";

    // we're in a member expression and we're the computed property so we're referenced
    var isComputedProperty = isMemberExpression && parent.property === node && parent.computed;

    // we're in a member expression and we're the object so we're referenced
    var isObject = isMemberExpression && parent.object === node;

    // we are referenced
    return !isMemberExpression || isComputedProperty || isObject;
};

var drawLoopMethods = ["draw", "mouseClicked", "mouseDragged", "mouseMoved", "mousePressed", "mouseReleased", "mouseScrolled", "mouseOver", "mouseOut", "touchStart", "touchEnd", "touchMove", "touchCancel", "keyPressed", "keyReleased", "keyTyped"];

var scopes = [{}];

/**
 * Returns a visitor object that will rewrite all global variable references to
 * be references to properties on an object identified by envName.
 *
 * e.g. fill(200,124,93) => __env__19283123.fill(200,124,93)
 *
 * @param {string} envName
 * @returns {Object}
 */
ASTTransforms.rewriteContextVariables = function(envName, context){
    var old = {
        enter: function enter(node, path) {
            // Create a new scope whenever we encounter a function declaration/expression
            // and add all of its paramters to this new scope.
            if (/^Function/.test(node.type)) {
                (function () {
                    var scope = {};
                    node.params.forEach(function (param) {
                        scope[param.name] = true;
                    });
                    scopes.push(scope);
                })();
            }
            // Add any variables declared to the current scope.  This handles
            // variable declarations with multiple declarators, e.g. var x = 5, y = 10;
            // because we are handling all of the declarators directly (as opposed
            // to iterating over node.declarators when node.type === "VariableDeclaration").
            if (node.type === "VariableDeclarator") {
                var scope = scopes[scopes.length - 1];
                scope[node.id.name] = true;
            }
        },
        leave: function leave(node, path) {
            var parent = path[path.length - 2];
            
            if (node.type === "Identifier") {
                if(parent.type === "MethodDefinition"){return;}
                if (parent.type === "ArrayPattern" ? isReference(node, path[path.length - 3]) : isReference(node, parent)) {
                    var scopeIndex = -1;
                    for (var i = scopes.length - 1; i > -1; i--) {
                        if (scopes[i][node.name]) {
                            scopeIndex = i;
                            break;
                        }
                    }

                    // Don't rewrite function parameters.
                    var isParam = /^Function/.test(parent.type) && parent.params.includes(node);
                    if (isParam) {
                        return;
                    }

                    // Don't catch clause parameters.
                    if (parent.type === "CatchClause") {
                        return;
                    }

                    // These values show up a Identifiers in the AST.  We don't
                    // want to prefix them so return.
                    if (["undefined", "Infinity", "NaN", "arguments"].includes(node.name)) {
                        return;
                    }
                    
                    // Prefix identifiers that exist in the context object and
                    // have not been defined in any scope.
                    // Also, prefix any other identifers that
                    // exist at the global scope.
                    if (node.name in context && scopeIndex === -1 || scopeIndex === 0) {
                        return b.MemberExpression(b.Identifier(envName), b.Identifier(node.name));
                    }
                }
            } else if (node.type === "VariableDeclaration") {
                
                if (node.declarations.length === 1) {
                    // Single VariableDeclarators
                    var decl = node.declarations[0];

                    // If the current variable declaration has an "init" value of null
                    //  (IE. no init value given to parser), and the current node type
                    //  doesn't match "ForInStatement" (a for-in loop), exit the
                    //  function.
                    if (decl.init === null && parent.type !== "ForInStatement") {
                        return;
                    }



                    // Rewrite all function declarations, e.g.
                    // var foo = function () {} => __env__.foo = function () {}
                    // that appear in the global scope. Draw loop methods aren't
                    // special, they should be treated in the exact same way.
                    if (scopes.length === 1) {
                        if (["Program", "BlockStatement", "SwitchCase"].includes(parent.type)) {
                            return b.ExpressionStatement(b.AssignmentExpression(b.MemberExpression(b.Identifier(envName), b.Identifier(decl.id.name)), "=", decl.init));
                        } else {
                            if (["ForStatement"].includes(parent.type)) {
                                // Handle variables declared inside a 'for' statement
                                // occurring in the global scope.
                                //
                                // e.g. for (var i = 0; i < 10; i++) { ... } =>
                                //      for (__env__.i = 0; __env__.i < 10; __env__.i++)
                                return b.AssignmentExpression(b.MemberExpression(b.Identifier(envName), b.Identifier(decl.id.name)), "=", decl.init);
                            } else if (["ForInStatement"].includes(parent.type)) {
                                // Handle variables declared inside a 'for in' statement,
                                //  occuring in the global scope.
                                // Example:
                                //  for (var i in obj) { ... }
                                //  for (__env__.i in __env__.obj) { ... }
                                return b.MemberExpression(b.Identifier(envName), b.Identifier(decl.id.name));
                            }
                        }
                    }
                } else {
                    // Multiple VariableDeclarators
                    
                    if (scopes.length === 1) {
                        if (["Program", "BlockStatement"].includes(parent.type)) {
                            // Before: var x = 5, y = 10, z;
                            // After: __env__.x = 5; __env__.y = 10;

                            return node.declarations.filter(function (decl) {
                                return decl.init !== null;
                            }).map(function (decl) {
                                return b.ExpressionStatement(b.AssignmentExpression(b.MemberExpression(b.Identifier(envName), b.Identifier(decl.id.name)), "=", decl.init));
                            });
                        } else {
                            // Before: for (var i = 0, j = 0; i * j < 100; i++, j++) { ... }
                            // After: for (__env__.i = 0, __env__.j = 0; __env__.i * __env__.j < 100; ...) { ... }

                            return {
                                type: "SequenceExpression",
                                expressions: node.declarations.filter(function (decl) {
                                    return decl.init !== null;
                                }).map(function (decl) {
                                    return b.AssignmentExpression(b.MemberExpression(b.Identifier(envName), b.Identifier(decl.id.name)), "=", decl.init);
                                })
                            };
                        }
                    } else if (node.declarations.some(decl => drawLoopMethods.includes(decl.id.name))) {
                        // this is super edge case, it handles things that look like
                        // var draw = function() {
                        //     var x = 5, mouseClicked = function () { ... }, y = 10;
                        // };
                        // It should convert them to something like this:
                        // __env__.draw = function() {
                        //     var x = 5;
                        //     var mouseClicked = function () { ... };
                        //     var y = 10;
                        // };

                        return node.declarations
                            .filter(decl => decl.init !== null)
                            .map(decl => {
                                return b.VariableDeclaration([decl], node.kind);
                            });
                    }
                }
            }
        }
    };

    function isPJS(name){
        for(let p = context; p.__proto__ !== null; p = p.__proto__){
            if(p.hasOwnProperty(name)){
                return true
            }
        }
        return false;
    }

    return {
        enter: old.enter,
        leave(node, path){
            if (/^Function/.test(node.type)) {
                // Remove all local variables from the scopes stack as we exit
                // the function expression/declaration.
                scopes.pop();
            }
            else if(node.type === "Identifier"){
                if(isPJS(node.name)){ return old.leave(node, path); }
            }
            else if(node.type === "VariableDeclaration" && node.declarations.some(d=>isPJS(d.id.name))){
                return old.leave(node, path);
            }
        }
    }
};

ASTTransforms.checkForBannedProps = function (bannedProps) {
    return {
        leave: function leave(node, path) {
            if (node.type === "Identifier" && bannedProps.includes(node.name)) {
                throw `Use of "${node.name}" as an identifier is prohibited. (${node.loc.start.line - 1})`;
            }
        }
    };
};

/**
 * Searches for strings containing the name of any image or sound we provide for
 * users and adds them to `resources` as a key.
 *
 * @param {Object} resources An empty Object.
 * @returns {Object} An AST Visitor.
 */
ASTTransforms.findResources = function (resources) {
    return {
        leave: function leave(node, path) {
            if (node.type === "Literal" && typeof node.value === "string") {

                AllImages.forEach(function (group) {
                    group.images.forEach(function (image) {
                        if (node.value.indexOf(image) !== -1) {
                            resources[group.groupName + "/" + image + ".png"] = true;
                        }
                    });
                });

                OutputSounds.forEach(function (cls) {
                    cls.groups.forEach(function (group) {
                        group.sounds.forEach(function (sound) {
                            if (node.value.indexOf(sound) !== -1) {
                                resources[group.groupName + "/" + sound + ".mp3"] = true;
                            }
                        });
                    });
                });
            }
        }
    };
};

ASTTransforms.rewriteFunctionDeclarations = {
    leave(node, path) {
        if (node.type === "FunctionDeclaration") {
            var decl = {
                type: "VariableDeclarator",
                id: {
                    type: "Identifier",
                    name: node.id.name
                },
                init: {
                    type: "FunctionExpression",
                    id: null,
                    params: node.params,
                    body: node.body,
                    generator: node.generator,
                    expression: node.expression,
                    async: node.async
                }
            };
            return b.VariableDeclaration([decl], "var");
        }
    }
};

window.ASTTransforms = ASTTransforms;
window.ASTBuilder = ASTTransforms;
window.walkAST = walkAST;

export { ASTTransforms, ASTBuilder, walkAST };